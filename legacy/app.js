/* Écoute — French Listening Tracker
 * All data lives in localStorage. Session shape:
 * { id, date: 'YYYY-MM-DD', minutes, type: 'youtube'|'podcast', title, createdAt }
 */

const STORAGE_KEY = 'ecoute.sessions';
const GOAL_KEY = 'ecoute.goalMinutes';
const LANG_KEY = 'ecoute.lang';
const DEFAULT_GOAL = 30;

/* ── i18n ─────────────────────────────────── */
const I18N = {
  en: {
    tagline: 'French Listening Tracker',
    export: 'Export CSV',
    today: 'Today',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    streak: 'Day Streak',
    liveTimer: 'Live Timer',
    start: '▶ Start',
    pause: '⏸ Pause',
    resume: '▶ Resume',
    stopSave: '■ Stop & Save',
    manualEntry: 'Manual Entry',
    addSession: '+ Add Session',
    dailyGoal: 'Daily goal (minutes)',
    dashboard: 'Dashboard',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    bySource: 'By Source',
    recentSessions: 'Recent Sessions',
    noSessions: 'No sessions yet — start the timer or add one manually. Bonne écoute ! 🎧',
    footer: 'Data is stored locally in your browser.',
    whatListening: 'What are you listening to? (optional)',
    minutes: 'Minutes',
    titleOptional: 'Title (optional)',
    goalOf: 'of',
    goalUnit: 'min goal',
    goalDone: 'Goal reached! 🎉',
    avgPerDay: 'avg/day',
    totalAllTime: 'total all time',
    minutesLabel: 'Minutes',
    last14: 'Last 14 days',
    last12w: 'Last 12 weeks',
    last12m: 'Last 12 months',
    confirmDelete: 'Delete this session?',
    untitled: '(untitled)',
    weekPrefix: 'Wk of ',
  },
  zh: {
    tagline: '法語聽力時數追蹤',
    export: '匯出 CSV',
    today: '今天',
    thisWeek: '本週',
    thisMonth: '本月',
    streak: '連續天數',
    liveTimer: '即時計時',
    start: '▶ 開始',
    pause: '⏸ 暫停',
    resume: '▶ 繼續',
    stopSave: '■ 停止並儲存',
    manualEntry: '手動記錄',
    addSession: '＋ 新增紀錄',
    dailyGoal: '每日目標（分鐘）',
    dashboard: '儀表板',
    daily: '每日',
    weekly: '每週',
    monthly: '每月',
    bySource: '來源分佈',
    recentSessions: '最近紀錄',
    noSessions: '還沒有紀錄 — 開始計時或手動新增一筆吧。Bonne écoute ! 🎧',
    footer: '資料儲存在你的瀏覽器本機。',
    whatListening: '正在聽什麼？（選填）',
    minutes: '分鐘',
    titleOptional: '標題（選填）',
    goalOf: '/',
    goalUnit: '分鐘目標',
    goalDone: '達成目標！🎉',
    avgPerDay: '平均／天',
    totalAllTime: '累計總時數',
    minutesLabel: '分鐘',
    last14: '最近 14 天',
    last12w: '最近 12 週',
    last12m: '最近 12 個月',
    confirmDelete: '確定要刪除這筆紀錄嗎？',
    untitled: '（無標題）',
    weekPrefix: '週：',
  },
};

let lang = localStorage.getItem(LANG_KEY) || 'en';
const t = (key) => I18N[lang][key] ?? key;

function applyI18n() {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.getElementById('langToggle').textContent = lang === 'en' ? '繁中' : 'EN';
  // Timer buttons may be in a paused state with dynamic labels
  syncTimerButtons();
}

/* ── Data ─────────────────────────────────── */
function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function addSession({ date, minutes, type, title }) {
  const sessions = loadSessions();
  sessions.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date,
    minutes,
    type,
    title: title.trim(),
    createdAt: new Date().toISOString(),
  });
  saveSessions(sessions);
  render();
}

function deleteSession(id) {
  saveSessions(loadSessions().filter((s) => s.id !== id));
  render();
}

function getGoal() {
  return parseInt(localStorage.getItem(GOAL_KEY), 10) || DEFAULT_GOAL;
}

/* ── Date helpers ─────────────────────────── */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dateKey(new Date());

function startOfWeek(d) {
  // Monday-based week
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtMinutes(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ── Aggregation ──────────────────────────── */
function minutesByDate(sessions) {
  const map = {};
  for (const s of sessions) map[s.date] = (map[s.date] || 0) + s.minutes;
  return map;
}

function computeStats(sessions) {
  const byDate = minutesByDate(sessions);
  const now = new Date();
  const today = byDate[todayKey()] || 0;

  const weekStart = startOfWeek(now);
  let week = 0;
  let month = 0;
  let total = 0;
  const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  for (const [date, mins] of Object.entries(byDate)) {
    total += mins;
    if (new Date(date + 'T00:00:00') >= weekStart) week += mins;
    if (date.startsWith(monthPrefix)) month += mins;
  }

  // Streak: consecutive days with any listening, counting back from today
  // (or yesterday, so an unfinished today doesn't break it).
  let streak = 0;
  const cursor = new Date();
  if (!byDate[dateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (byDate[dateKey(cursor)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const dayOfWeek = (now.getDay() + 6) % 7 + 1;
  const dayOfMonth = now.getDate();

  return {
    today,
    week,
    month,
    total,
    streak,
    weekAvg: Math.round(week / dayOfWeek),
    monthAvg: Math.round(month / dayOfMonth),
  };
}

function dailySeries(sessions, days = 14) {
  const byDate = minutesByDate(sessions);
  const labels = [];
  const data = [];
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const key = dateKey(d);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    data.push(byDate[key] || 0);
    d.setDate(d.getDate() + 1);
  }
  return { labels, data };
}

function weeklySeries(sessions, weeks = 12) {
  const totals = {};
  for (const s of sessions) {
    const key = dateKey(startOfWeek(new Date(s.date + 'T00:00:00')));
    totals[key] = (totals[key] || 0) + s.minutes;
  }
  const labels = [];
  const data = [];
  const cursor = startOfWeek(new Date());
  cursor.setDate(cursor.getDate() - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    labels.push(`${t('weekPrefix')}${cursor.getMonth() + 1}/${cursor.getDate()}`);
    data.push(totals[dateKey(cursor)] || 0);
    cursor.setDate(cursor.getDate() + 7);
  }
  return { labels, data };
}

function monthlySeries(sessions, months = 12) {
  const totals = {};
  for (const s of sessions) {
    const key = s.date.slice(0, 7);
    totals[key] = (totals[key] || 0) + s.minutes;
  }
  const labels = [];
  const data = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    labels.push(key);
    data.push(totals[key] || 0);
  }
  return { labels, data };
}

/* ── Charts ───────────────────────────────── */
let mainChart = null;
let typeChart = null;
let currentView = 'daily';

const CHART_TITLES = { daily: 'last14', weekly: 'last12w', monthly: 'last12m' };

function renderMainChart(sessions) {
  const series =
    currentView === 'daily' ? dailySeries(sessions) :
    currentView === 'weekly' ? weeklySeries(sessions) :
    monthlySeries(sessions);

  const goal = getGoal();
  const goalLine = currentView === 'daily' ? goal :
    currentView === 'weekly' ? goal * 7 : null;

  if (mainChart) mainChart.destroy();
  mainChart = new Chart(document.getElementById('mainChart'), {
    type: 'bar',
    data: {
      labels: series.labels,
      datasets: [{
        label: t('minutesLabel'),
        data: series.data,
        backgroundColor: series.data.map((v) =>
          goalLine && v >= goalLine ? 'rgba(22, 163, 74, 0.75)' : 'rgba(43, 79, 216, 0.75)'),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: t(CHART_TITLES[currentView]), color: '#6b7280', font: { size: 12 } },
        tooltip: {
          callbacks: { label: (ctx) => fmtMinutes(ctx.parsed.y) },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef0f6' } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderTypeChart(sessions) {
  let yt = 0;
  let pc = 0;
  for (const s of sessions) (s.type === 'podcast' ? (pc += s.minutes) : (yt += s.minutes));

  if (typeChart) typeChart.destroy();
  typeChart = new Chart(document.getElementById('typeChart'), {
    type: 'doughnut',
    data: {
      labels: ['YouTube', 'Podcast'],
      datasets: [{
        data: [yt, pc],
        backgroundColor: ['#ef4135', '#2b4fd8'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtMinutes(ctx.parsed)}` } },
      },
    },
  });
}

/* ── Render ───────────────────────────────── */
function render() {
  const sessions = loadSessions();
  const stats = computeStats(sessions);
  const goal = getGoal();

  document.getElementById('statToday').textContent = fmtMinutes(stats.today);
  document.getElementById('statWeek').textContent = fmtMinutes(stats.week);
  document.getElementById('statMonth').textContent = fmtMinutes(stats.month);
  document.getElementById('statStreak').textContent = `${stats.streak} 🔥`;
  document.getElementById('statWeekAvg').textContent = `${fmtMinutes(stats.weekAvg)} ${t('avgPerDay')}`;
  document.getElementById('statMonthAvg').textContent = `${fmtMinutes(stats.monthAvg)} ${t('avgPerDay')}`;
  document.getElementById('statTotal').textContent = `${fmtMinutes(stats.total)} ${t('totalAllTime')}`;

  const pct = Math.min(100, Math.round((stats.today / goal) * 100));
  const fill = document.getElementById('goalFill');
  fill.style.width = pct + '%';
  fill.classList.toggle('done', pct >= 100);
  document.getElementById('goalText').textContent =
    pct >= 100 ? t('goalDone') : `${stats.today} ${t('goalOf')} ${goal} ${t('goalUnit')}`;

  renderMainChart(sessions);
  renderTypeChart(sessions);
  renderSessionList(sessions);
}

function renderSessionList(sessions) {
  const list = document.getElementById('sessionList');
  const empty = document.getElementById('emptyMsg');
  list.innerHTML = '';
  const recent = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);

  empty.style.display = recent.length ? 'none' : 'block';

  for (const s of recent) {
    const li = document.createElement('li');
    li.className = 'session-item';

    const icon = document.createElement('span');
    icon.className = 'session-icon';
    icon.textContent = s.type === 'podcast' ? '🎙️' : '▶️';

    const info = document.createElement('div');
    info.className = 'session-info';
    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = s.title || t('untitled');
    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = `${s.date} · ${s.type === 'podcast' ? 'Podcast' : 'YouTube'}`;
    info.append(title, meta);

    const mins = document.createElement('span');
    mins.className = 'session-mins';
    mins.textContent = fmtMinutes(s.minutes);

    const del = document.createElement('button');
    del.className = 'session-del';
    del.textContent = '✕';
    del.title = 'Delete';
    del.onclick = () => {
      if (confirm(t('confirmDelete'))) deleteSession(s.id);
    };

    li.append(icon, info, mins, del);
    list.appendChild(li);
  }
}

/* ── Timer ────────────────────────────────── */
let timerState = 'idle'; // idle | running | paused
let elapsedSec = 0;
let tickHandle = null;
let lastTick = null;

function fmtClock(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function tick() {
  const now = Date.now();
  elapsedSec += Math.round((now - lastTick) / 1000);
  lastTick = now;
  document.getElementById('timerDisplay').textContent = fmtClock(elapsedSec);
}

function syncTimerButtons() {
  const startBtn = document.getElementById('timerStart');
  const pauseBtn = document.getElementById('timerPause');
  const stopBtn = document.getElementById('timerStop');
  const card = document.querySelector('.timer-card');

  startBtn.disabled = timerState === 'running';
  pauseBtn.disabled = timerState !== 'running';
  stopBtn.disabled = timerState === 'idle';
  startBtn.textContent = timerState === 'paused' ? t('resume') : t('start');
  card.classList.toggle('running', timerState === 'running');
}

function startTimer() {
  timerState = 'running';
  lastTick = Date.now();
  tickHandle = setInterval(tick, 1000);
  syncTimerButtons();
}

function pauseTimer() {
  timerState = 'paused';
  tick();
  clearInterval(tickHandle);
  syncTimerButtons();
}

function stopTimer() {
  if (timerState === 'running') tick();
  clearInterval(tickHandle);
  const minutes = Math.max(1, Math.round(elapsedSec / 60));
  if (elapsedSec >= 10) {
    addSession({
      date: todayKey(),
      minutes,
      type: document.getElementById('timerType').value,
      title: document.getElementById('timerTitle').value,
    });
  }
  timerState = 'idle';
  elapsedSec = 0;
  document.getElementById('timerDisplay').textContent = fmtClock(0);
  document.getElementById('timerTitle').value = '';
  syncTimerButtons();
}

// Warn before closing the tab with a running timer
window.addEventListener('beforeunload', (e) => {
  if (timerState !== 'idle') {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ── CSV export ───────────────────────────── */
function exportCSV() {
  const sessions = loadSessions().sort((a, b) => a.date.localeCompare(b.date));
  const rows = [['date', 'minutes', 'type', 'title']];
  for (const s of sessions) {
    rows.push([s.date, s.minutes, s.type, `"${(s.title || '').replace(/"/g, '""')}"`]);
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `listening-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Wire up ──────────────────────────────── */
document.getElementById('timerStart').addEventListener('click', startTimer);
document.getElementById('timerPause').addEventListener('click', pauseTimer);
document.getElementById('timerStop').addEventListener('click', stopTimer);
document.getElementById('exportBtn').addEventListener('click', exportCSV);

document.getElementById('langToggle').addEventListener('click', () => {
  lang = lang === 'en' ? 'zh' : 'en';
  localStorage.setItem(LANG_KEY, lang);
  applyI18n();
  render();
});

document.getElementById('manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const minutes = parseInt(document.getElementById('manualMinutes').value, 10);
  if (!minutes || minutes < 1) return;
  addSession({
    date: document.getElementById('manualDate').value,
    minutes,
    type: document.getElementById('manualType').value,
    title: document.getElementById('manualTitle').value,
  });
  document.getElementById('manualMinutes').value = '';
  document.getElementById('manualTitle').value = '';
});

const goalInput = document.getElementById('goalInput');
goalInput.value = getGoal();
goalInput.addEventListener('change', () => {
  const v = parseInt(goalInput.value, 10);
  if (v >= 5) {
    localStorage.setItem(GOAL_KEY, v);
    render();
  }
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    renderMainChart(loadSessions());
  });
});

document.getElementById('manualDate').value = todayKey();
applyI18n();
render();

// Refresh stats at midnight rollover
setInterval(() => {
  if (document.getElementById('manualDate').value !== todayKey()) {
    document.getElementById('manualDate').value = todayKey();
    render();
  }
}, 60000);
