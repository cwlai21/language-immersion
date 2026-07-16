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
let tracking = null;     // { currentSession, overrides, trackedChannels, pendingCount }
let statsLang = 'fr';    // which language the quick stats show
let statsRows = null;    // cached rows for the current stats window

function asrLanguage(video) {
  const asr = (video.asrLang || '').toLowerCase();
  if (asr.startsWith('fr')) return 'fr';
  if (asr.startsWith('en')) return 'en';
  return null;
}

/* ── Current video status ─────────────────── */
async function loadStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tracking = await chrome.runtime.sendMessage({ type: 'get-tracking-status' });

  if (tab && tab.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtube.com/shorts'))) {
    try {
      pageStatus = await chrome.tabs.sendMessage(tab.id, { type: 'get-page-status' });
    } catch {
      pageStatus = null; // content script not loaded (e.g. extension just installed)
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

function renderStatus() {
  const line = document.getElementById('statusLine');
  const title = document.getElementById('statusTitle');
  const sess = document.getElementById('statusSession');
  const actions = document.getElementById('statusActions');
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

  const { goals = { fr: 30, en: 30 } } = await chrome.storage.sync.get('goals');
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

/* ── Manual entry ─────────────────────────── */
document.getElementById('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const minutes = parseInt(document.getElementById('mMinutes').value, 10);
  if (!minutes) return;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await sb.insertSession({
      date: document.getElementById('mDate').value,
      seconds: minutes * 60,
      language: document.getElementById('mLang').value,
      type: document.getElementById('mType').value,
      title: document.getElementById('mTitle').value.trim(),
      source: 'manual',
    });
    document.getElementById('mMinutes').value = '';
    document.getElementById('mTitle').value = '';
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
    applyI18n();
    renderStatus();
    renderStats();
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
  await loadStatus();
  await loadStats();
  // Refresh the live session counter while the popup stays open.
  setInterval(async () => {
    await loadStatus();
    renderStats();
  }, 5000);
})();
