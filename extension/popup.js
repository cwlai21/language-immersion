/* Popup: shows tracking status for the active tab, per-language quick stats
 * from Supabase, manual entry, and per-video / per-channel controls. */

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// The tracker's day starts at 4am (like Anki's rollover), so "today"
// computations shift the clock back four hours.
const ROLLOVER_HOUR = 4;
const logicalNow = () => new Date(Date.now() - ROLLOVER_HOUR * 3600 * 1000);
const todayKey = () => dateKey(logicalNow());

function startOfWeek(d) {
  const out = new Date(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtMinutes(mins) {
  mins = Math.round(mins);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

let pageStatus = null;   // { video, playing } from the content script
let seriesStatus = null; // { meta, playing } from series-detect.js on streaming sites
let tracking = null;     // { currentSession, currentSeries, overrides, trackedChannels, seriesLangs, pendingCount }
let statsLang = 'fr';    // which language the quick stats show
let statsRows = null;    // cached rows for the current stats window

const SERIES_SITE_RE = /https:\/\/(gimytv\.biz|gimyai\.tw|[^/]*\.netflix\.com|[^/]*\.disneyplus\.com)\//;

function asrLanguage(video) {
  const asr = (video.asrLang || '').toLowerCase();
  if (asr.startsWith('fr')) return 'fr';
  if (asr.startsWith('en')) return 'en';
  return null;
}

/* ── Current video status ─────────────────── */
async function loadStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tracking = await chrome.runtime.sendMessage({ type: 'get-tracking-status', tabId: tab ? tab.id : null });

  if (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtube.com/shorts'))) {
    try {
      pageStatus = await chrome.tabs.sendMessage(tab.id, { type: 'get-page-status' });
    } catch {
      pageStatus = null; // content script not loaded (e.g. extension just installed)
      // Ask the worker to re-inject right away; the 5s refresh loop picks
      // up the healed tab without the user having to reload the page.
      chrome.runtime.sendMessage({ type: 'heal-tab', tabId: tab.id }).catch(() => {});
    }
  } else if (tab && tab.url && SERIES_SITE_RE.test(tab.url)) {
    try {
      seriesStatus = await chrome.tabs.sendMessage(tab.id, { type: 'get-series-status' });
    } catch {
      seriesStatus = null;
      chrome.runtime.sendMessage({ type: 'heal-tab', tabId: tab.id }).catch(() => {});
    }
  }
  renderStatus();
}

function makeBtn(label, onClick, primary = false) {
  const b = document.createElement('button');
  b.className = 'mini-btn' + (primary ? ' primary' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function renderSeriesStatus() {
  const line = document.getElementById('statusLine');
  const title = document.getElementById('statusTitle');
  const sess = document.getElementById('statusSession');
  const actions = document.getElementById('statusActions');
  actions.innerHTML = '';

  const meta = seriesStatus.meta;
  const { seriesLangs = {}, currentSeries } = tracking || {};
  const pin = seriesLangs[meta.name];
  const lang = pin === 'fr' || pin === 'en' ? pin : null;

  if (lang) {
    line.textContent = '🎧 ' + t(lang === 'fr' ? 'seriesTrackedFr' : 'seriesTrackedEn');
    line.className = 'status-line on';
  } else if (pin === false) {
    line.textContent = t('excluded');
    line.className = 'status-line off';
  } else {
    line.textContent = t('seriesDetected');
    line.className = 'status-line off';
  }
  const ep = meta.episode ? ` · S${meta.season || 1}E${meta.episode}` : '';
  title.textContent = `📺 ${meta.name}${ep}${meta.epTitle ? ' · ' + meta.epTitle : ''}`;

  if (currentSeries && currentSeries.name === meta.name && currentSeries.seconds > 0) {
    sess.textContent = `${fmtMinutes(currentSeries.seconds / 60)} ${t('thisSession')}`;
  } else {
    sess.textContent = '';
  }

  const setLang = (value) => async () => {
    await chrome.runtime.sendMessage({ type: 'set-series-lang', name: meta.name, lang: value });
    loadStatus();
  };
  if (lang) {
    const other = lang === 'fr' ? 'en' : 'fr';
    actions.appendChild(makeBtn(t(other === 'fr' ? 'trackAsFr' : 'trackAsEn'), setLang(other)));
    // false, not null: an explicit exclusion also blocks the TMDB
    // original-language auto-pin from immediately re-tracking the show.
    actions.appendChild(makeBtn(t('dontTrackThis'), setLang(false)));
  } else {
    actions.appendChild(makeBtn(t('trackAsFr'), setLang('fr'), true));
    actions.appendChild(makeBtn(t('trackAsEn'), setLang('en'), true));
  }
  actions.hidden = false;
}

function renderStatus() {
  const line = document.getElementById('statusLine');
  const title = document.getElementById('statusTitle');
  const sess = document.getElementById('statusSession');
  const actions = document.getElementById('statusActions');

  if (seriesStatus && seriesStatus.meta) {
    renderSeriesStatus();
    return;
  }
  actions.innerHTML = '';

  const video = pageStatus && pageStatus.video;
  if (!video) {
    line.textContent = t('notYouTube');
    line.className = 'status-line';
    title.textContent = '';
    sess.textContent = '';
    actions.hidden = true;
    return;
  }

  const { overrides = {}, trackedChannels = [], currentSession } = tracking || {};
  const ov = overrides[video.videoId];
  const channelEntry = trackedChannels.find((c) => c.id === video.channelId);
  const detected = asrLanguage(video);
  // No ASR yet (e.g. a video too new to be auto-captioned) — fall back to
  // guessing from the title, same precedence as the background.
  const titleGuess = !detected ? guessLangFromTitle(video.title) : null;

  // Effective language + status label (same precedence as the background).
  let effLang = null;
  let label;
  if (ov === false) {
    label = t('excluded');
  } else if (ov === 'fr' || ov === 'en') {
    effLang = ov;
    label = t(ov === 'fr' ? 'trackedByOverrideFr' : 'trackedByOverrideEn');
  } else if (channelEntry) {
    effLang = channelEntry.lang;
    label = t(channelEntry.lang === 'fr' ? 'trackedByChannelFr' : 'trackedByChannelEn');
  } else if (detected) {
    effLang = detected;
    label = t(detected === 'fr' ? 'detectedFr' : 'detectedEn');
  } else if (titleGuess) {
    effLang = titleGuess;
    label = t(titleGuess === 'fr' ? 'guessedTitleFr' : 'guessedTitleEn');
  } else {
    label = t('notDetected');
  }

  line.textContent = (effLang ? '🎧 ' : '') + label;
  line.className = 'status-line ' + (effLang ? 'on' : 'off');
  title.textContent = `${video.channel} · ${video.title}`;

  if (currentSession && currentSession.videoId === video.videoId) {
    sess.textContent = `${fmtMinutes(currentSession.seconds / 60)} ${t('thisSession')}`;
  } else {
    sess.textContent = '';
  }

  const setOverride = (value) => async () => {
    await chrome.runtime.sendMessage({ type: 'set-override', videoId: video.videoId, value });
    loadStatus();
  };

  if (effLang) {
    actions.appendChild(makeBtn(t('dontTrackThis'), setOverride(false)));
    // Offer switching the language if detection got it wrong.
    const other = effLang === 'fr' ? 'en' : 'fr';
    actions.appendChild(makeBtn(t(other === 'fr' ? 'trackAsFr' : 'trackAsEn'), setOverride(other)));
    actions.appendChild(makeBtn(
      channelEntry ? t('stopChannel') : t('alwaysChannel'),
      async () => {
        await chrome.runtime.sendMessage({
          type: 'toggle-channel',
          channelId: video.channelId,
          channel: video.channel,
          lang: effLang,
        });
        loadStatus();
      }
    ));
  } else {
    actions.appendChild(makeBtn(t('trackAsFr'), setOverride('fr'), true));
    actions.appendChild(makeBtn(t('trackAsEn'), setOverride('en'), true));
  }
  actions.hidden = false;
}

/* ── Quick stats from Supabase ────────────── */
async function loadStats() {
  const now = logicalNow();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const weekStart = dateKey(startOfWeek(now));
  const from = weekStart < monthStart ? weekStart : monthStart;

  try {
    statsRows = await sb.listSessions(`select=date,seconds,language&date=gte.${from}`);
  } catch (e) {
    document.getElementById('errorText').textContent = t('loadError');
    document.getElementById('errorText').hidden = false;
    return;
  }
  renderStats();
}

async function renderStats() {
  if (!statsRows) return;
  const now = logicalNow();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const weekStart = dateKey(startOfWeek(now));
  const tk = todayKey();

  let today = 0;
  let week = 0;
  let month = 0;
  for (const r of statsRows) {
    if ((r.language || 'fr') !== statsLang) continue;
    const mins = r.seconds / 60;
    if (r.date === tk) today += mins;
    if (r.date >= weekStart) week += mins;
    if (r.date >= monthStart) month += mins;
  }

  // Include the live in-progress session so the numbers feel real-time.
  const live = tracking && tracking.currentSession;
  if (live && live.date === tk && (live.lang || 'fr') === statsLang) {
    today += live.seconds / 60;
    week += live.seconds / 60;
    month += live.seconds / 60;
  }

  document.getElementById('qsToday').textContent = fmtMinutes(today);
  document.getElementById('qsWeek').textContent = fmtMinutes(week);
  document.getElementById('qsMonth').textContent = fmtMinutes(month);

  // Supabase is the source of truth (same key the dashboards use) so a goal
  // changed from either dashboard shows up here too, not just chrome.storage.sync.
  let goals;
  try {
    const rows = await sbRequest('kv_state?key=eq.daily-goals&select=value');
    goals = rows.length ? JSON.parse(rows[0].value) : null;
  } catch { goals = null; }
  if (!goals) ({ goals = { fr: 30, en: 30 } } = await chrome.storage.sync.get('goals'));
  const goal = goals[statsLang] || 30;
  const pct = Math.min(100, Math.round((today / goal) * 100));
  const fill = document.getElementById('goalFill');
  fill.style.width = pct + '%';
  fill.classList.toggle('done', pct >= 100);
  document.getElementById('goalText').textContent =
    pct >= 100 ? t('goalDone') : `${Math.round(today)} ${t('goalOf')} ${goal} ${t('goalUnit')}`;

  const pendingText = document.getElementById('pendingText');
  if (tracking && tracking.pendingCount > 0) {
    pendingText.textContent = `⚠ ${tracking.pendingCount} ${t('pendingSync')}`;
    pendingText.hidden = false;
    chrome.runtime.sendMessage({ type: 'sync-now' });
  } else {
    pendingText.hidden = true;
  }
}

/* ── Series entry (TMDB duration lookup) ──── */
const mType = document.getElementById('mType');
const mMinutes = document.getElementById('mMinutes');
const mTitle = document.getElementById('mTitle');
const seriesRow = document.getElementById('seriesRow');
const seriesLookupStatus = document.getElementById('seriesLookupStatus');
const tmdbKeyRow = document.getElementById('tmdbKeyRow');
const tmdbKeyToggle = document.getElementById('tmdbKeyToggle');
const mSeriesName = document.getElementById('mSeriesName');
const mSeason = document.getElementById('mSeason');
const mEpisode = document.getElementById('mEpisode');
const mTmdbKey = document.getElementById('mTmdbKey');

let seriesLookupTimer = null;
let seriesLookupSeq = 0; // drop out-of-order lookup responses
let autoFilledTitle = ''; // last title the lookup wrote, so a newer lookup may replace it

async function refreshSeriesUi() {
  const isSeries = mType.value === 'series';
  seriesRow.hidden = !isSeries;
  seriesLookupStatus.hidden = !isSeries;
  // Distinct from the generic "Title" placeholder so it's never mistaken
  // for the series-name field above it.
  mTitle.dataset.i18nPh = isSeries ? 'episodeTitlePh' : 'titleRequired';
  mTitle.placeholder = t(mTitle.dataset.i18nPh);
  if (!isSeries) return;

  const hasKey = !!(await tmdbGetApiKey());
  tmdbKeyRow.hidden = hasKey;
  tmdbKeyToggle.hidden = !hasKey;
  if (!hasKey) seriesLookupStatus.textContent = t('needTmdbKey');
}

mType.addEventListener('change', refreshSeriesUi);

tmdbKeyToggle.addEventListener('click', async () => {
  mTmdbKey.value = (await tmdbGetApiKey()) || '';
  tmdbKeyRow.hidden = false;
  tmdbKeyToggle.hidden = true;
});

// Debounced like the series fields below, rather than waiting for blur —
// inside a popup, clicking outside the field closes the whole popup instead
// of just blurring it, so "change" alone would rarely fire.
let tmdbKeySaveTimer = null;
mTmdbKey.addEventListener('input', () => {
  clearTimeout(tmdbKeySaveTimer);
  tmdbKeySaveTimer = setTimeout(async () => {
    const key = mTmdbKey.value.trim();
    if (!key) return;
    await tmdbSetApiKey(key);
    scheduleSeriesLookup();
  }, 150);
});
mTmdbKey.addEventListener('blur', () => {
  if (mTmdbKey.value.trim()) refreshSeriesUi(); // collapse the key row once saved
});

function scheduleSeriesLookup() {
  clearTimeout(seriesLookupTimer);
  // Short on purpose: this timer lives in the popup, which is killed the
  // instant it loses focus (e.g. clicking away to check an episode number),
  // so anything still waiting here when that happens is lost before it can
  // even reach the background worker.
  seriesLookupTimer = setTimeout(runSeriesLookup, 150);
}

async function runSeriesLookup() {
  const name = mSeriesName.value.trim();
  const season = parseInt(mSeason.value, 10);
  const episode = parseInt(mEpisode.value, 10);
  if (!name || !season || !episode) return;
  if (!(await tmdbGetApiKey())) return;
  const seq = ++seriesLookupSeq;

  seriesLookupStatus.hidden = false;
  seriesLookupStatus.textContent = t('lookupSearching');
  try {
    // Routed through the background worker, which outlives the popup —
    // the popup itself (and any fetch running inside it) is killed the
    // instant it loses focus, e.g. clicking over to check an episode
    // number on IMDb mid-lookup.
    const { info, error } = await chrome.runtime.sendMessage({ type: 'tmdb-lookup', name, season, episode });
    if (seq !== seriesLookupSeq) return; // superseded — e.g. E1 answered after E10
    if (error) throw new Error(error);
    if (info) {
      mMinutes.value = info.minutes;
      // Fill the title when empty, and also replace a title *we* filled —
      // typing "10" digit by digit fires a lookup for E1 whose title must
      // not stick. Never touch a title the user typed themselves.
      const cur = mTitle.value.trim();
      if (info.title && (!cur || cur === autoFilledTitle)) {
        mTitle.value = info.title;
        autoFilledTitle = info.title;
      }
      seriesLookupStatus.textContent = `${t('lookupFound')} ${info.minutes}m${info.title ? ' — ' + info.title : ''}`;
    } else {
      seriesLookupStatus.textContent = t('lookupNotFound');
    }
  } catch (e) {
    seriesLookupStatus.textContent = `⚠ ${e.message}`;
  }
}

[mSeriesName, mSeason, mEpisode].forEach((el) =>
  el.addEventListener('input', scheduleSeriesLookup));

/* ── Reading timer ────────────────────────── */
// One-tap timer for Kindle/paper reading, which can't be auto-detected.
// Only startedAt+lang live in chrome.storage.local (the popup is killed the
// instant it loses focus, so no in-memory state survives); stopping feeds
// the elapsed minutes into the manual form below rather than saving
// directly — the title (usually a chapter number) changes every session
// and needs a human edit anyway.
const readTimerBox = document.getElementById('readTimer');

async function renderReadingTimer() {
  const { readingTimer = null } = await chrome.storage.local.get('readingTimer');
  readTimerBox.innerHTML = '';

  if (!readingTimer) {
    const start = document.createElement('button');
    start.className = 'mini-btn grow';
    start.textContent = `📖 ${t('startReading')}`;
    start.onclick = async () => {
      await chrome.storage.local.set({ readingTimer: { startedAt: Date.now(), lang: statsLang } });
      renderReadingTimer();
    };
    readTimerBox.appendChild(start);
    return;
  }

  const elapsedMin = Math.floor((Date.now() - readingTimer.startedAt) / 60000);
  const stop = document.createElement('button');
  stop.className = 'mini-btn primary grow';
  stop.textContent = `⏹ ${t('stopReading')} — ${fmtMinutes(elapsedMin)}`;
  stop.onclick = async () => {
    // Closing the popup between stop and save loses the prefill — the timer
    // is already gone by then. Rare enough to keep the flow simple.
    await chrome.storage.local.remove('readingTimer');
    mType.value = 'reading';
    await refreshSeriesUi();
    mMinutes.value = Math.min(1440, Math.max(1, Math.round((Date.now() - readingTimer.startedAt) / 60000)));
    document.getElementById('mLang').value = readingTimer.lang;
    const { lastReadingTitle = '' } = await chrome.storage.sync.get('lastReadingTitle');
    if (!mTitle.value) mTitle.value = lastReadingTitle;
    renderReadingTimer();
    mTitle.focus();
    mTitle.select();
  };

  const cancel = document.createElement('button');
  cancel.className = 'mini-btn';
  cancel.textContent = '✕';
  cancel.title = t('cancel');
  cancel.onclick = async () => {
    await chrome.storage.local.remove('readingTimer');
    renderReadingTimer();
  };

  readTimerBox.append(stop, cancel);
}

/* ── Manual entry ─────────────────────────── */
document.getElementById('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const minutes = parseInt(mMinutes.value, 10);
  if (!minutes) return;
  const type = mType.value;
  const isSeries = type === 'series';
  if (isSeries && !mSeriesName.value.trim()) return;
  // Untitled sessions are meant to be dropped — refuse to save one in the
  // first place, whatever the type.
  if (!mTitle.value.trim()) { mTitle.focus(); return; }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await sb.insertSession({
      date: document.getElementById('mDate').value,
      seconds: minutes * 60,
      language: document.getElementById('mLang').value,
      type,
      title: mTitle.value.trim(),
      source: 'manual',
      ...(isSeries ? {
        channel: mSeriesName.value.trim(),
        season: parseInt(mSeason.value, 10) || null,
        episode: parseInt(mEpisode.value, 10) || null,
      } : {}),
    });
    // Remember the title to prefill the next reading-timer stop — chapter
    // titles ("The One Thing ch17") only need the number edited.
    if (type === 'reading') chrome.storage.sync.set({ lastReadingTitle: mTitle.value.trim() });
    mMinutes.value = '';
    mTitle.value = '';
    autoFilledTitle = '';
    mSeriesName.value = '';
    mSeason.value = '';
    mEpisode.value = '';
    seriesLookupStatus.textContent = '';
    btn.textContent = t('added');
    setTimeout(() => { btn.textContent = t('addSession'); }, 1200);
    loadStats();
  } catch {
    document.getElementById('errorText').textContent = t('loadError');
    document.getElementById('errorText').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ── Wire up ──────────────────────────────── */
document.querySelectorAll('[data-statslang]').forEach((pill) => {
  pill.addEventListener('click', async () => {
    document.querySelectorAll('[data-statslang]').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    statsLang = pill.dataset.statslang;
    await chrome.storage.sync.set({ statsLang });
    setUiLang(statsLang); // Français pill → French UI
    document.getElementById('mLang').value = statsLang; // default manual entries to the active language too
    applyI18n();
    renderStatus();
    renderStats();
    renderReadingTimer();
  });
});

document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

(async function init() {
  const { statsLang: savedStatsLang } = await chrome.storage.sync.get('statsLang');
  if (savedStatsLang) {
    statsLang = savedStatsLang;
    document.querySelectorAll('[data-statslang]').forEach((p) =>
      p.classList.toggle('active', p.dataset.statslang === statsLang));
  }

  setUiLang(statsLang);
  applyI18n();
  document.getElementById('mDate').value = todayKey();
  document.getElementById('mLang').value = statsLang;
  await refreshSeriesUi();
  await renderReadingTimer();
  await loadStatus();
  await loadStats();
  // Refresh the live session counter (and reading-timer elapsed) while the
  // popup stays open.
  setInterval(async () => {
    await loadStatus();
    renderStats();
    renderReadingTimer();
  }, 5000);
})();
