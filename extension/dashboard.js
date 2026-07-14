/* Dashboard page: sessions live in Supabase (listening_sessions), settings in
 * chrome.storage.sync. A language filter (All / FR / EN) drives all stats and
 * charts; the "All" view stacks French and English in the bar chart. */

let allSessions = []; // [{ id, date, seconds, language, type, title, channel, source, created_at }]
let goals = { fr: 30, en: 30 };
let langFilter = 'all'; // 'all' | 'fr' | 'en'

const LANG_COLORS = { fr: 'rgba(43, 79, 216, 0.8)', en: 'rgba(22, 163, 74, 0.8)' };
const LANG_FLAGS = { fr: '🇫🇷', en: '🇬🇧' };

/* ── Date helpers ─────────────────────────── */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// The tracker's day starts at 4am (like Anki's rollover), so "today" and all
// chart windows shift the clock back four hours.
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

function sessionLang(s) {
  return s.language === 'en' ? 'en' : 'fr';
}

function filteredSessions() {
  if (langFilter === 'all') return allSessions;
  return allSessions.filter((s) => sessionLang(s) === langFilter);
}

function currentGoal() {
  return langFilter === 'all' ? goals.fr + goals.en : goals[langFilter];
}

/* ── Data ─────────────────────────────────── */
async function fetchSessions() {
  allSessions = await sb.listSessions(
    'select=id,date,seconds,language,type,title,channel,source,created_at&order=date.desc,created_at.desc&limit=5000'
  );
}

async function removeSession(id) {
  await sb.deleteSession(id);
  await fetchSessions();
  render();
}

/* ── Aggregation (in minutes) ─────────────── */
function minutesByDate(sessions) {
  const map = {};
  for (const s of sessions) map[s.date] = (map[s.date] || 0) + s.seconds / 60;
  return map;
}

function computeStats(sessions) {
  const byDate = minutesByDate(sessions);
  const now = logicalNow();
  const today = byDate[todayKey()] || 0;

  const weekStartKey = dateKey(startOfWeek(now));
  const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  let week = 0;
  let month = 0;
  let total = 0;

  for (const [date, mins] of Object.entries(byDate)) {
    total += mins;
    if (date >= weekStartKey) week += mins;
    if (date.startsWith(monthPrefix)) month += mins;
  }

  let streak = 0;
  const cursor = logicalNow();
  if (!byDate[dateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (byDate[dateKey(cursor)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const dayOfWeek = ((now.getDay() + 6) % 7) + 1;
  return {
    today, week, month, total, streak,
    weekAvg: week / dayOfWeek,
    monthAvg: month / now.getDate(),
  };
}

function dailySeries(sessions, days = 14) {
  const byDate = minutesByDate(sessions);
  const labels = [];
  const data = [];
  const d = logicalNow();
  d.setDate(d.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    data.push(Math.round(byDate[dateKey(d)] || 0));
    d.setDate(d.getDate() + 1);
  }
  return { labels, data };
}

function weeklySeries(sessions, weeks = 12) {
  const totals = {};
  for (const s of sessions) {
    const key = dateKey(startOfWeek(new Date(s.date + 'T00:00:00')));
    totals[key] = (totals[key] || 0) + s.seconds / 60;
  }
  const labels = [];
  const data = [];
  const cursor = startOfWeek(logicalNow());
  cursor.setDate(cursor.getDate() - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    labels.push(`${t('weekPrefix')}${cursor.getMonth() + 1}/${cursor.getDate()}`);
    data.push(Math.round(totals[dateKey(cursor)] || 0));
    cursor.setDate(cursor.getDate() + 7);
  }
  return { labels, data };
}

function monthlySeries(sessions, months = 12) {
  const totals = {};
  for (const s of sessions) {
    const key = s.date.slice(0, 7);
    totals[key] = (totals[key] || 0) + s.seconds / 60;
  }
  const labels = [];
  const data = [];
  const now = logicalNow();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    labels.push(key);
    data.push(Math.round(totals[key] || 0));
  }
  return { labels, data };
}

/* ── Charts ───────────────────────────────── */
let mainChart = null;
let typeChart = null;
let currentView = 'daily';
const CHART_TITLES = { daily: 'last14', weekly: 'last12w', monthly: 'last12m' };

function seriesFor(sessions) {
  return currentView === 'daily' ? dailySeries(sessions) :
    currentView === 'weekly' ? weeklySeries(sessions) :
    monthlySeries(sessions);
}

function renderMainChart() {
  const goalLine =
    currentView === 'daily' ? currentGoal() :
    currentView === 'weekly' ? currentGoal() * 7 : null;

  let datasets;
  let labels;
  let stacked = false;
  let legend = { display: false };
  if (langFilter === 'all') {
    // Stacked bars: French + English per period.
    const fr = seriesFor(allSessions.filter((s) => sessionLang(s) === 'fr'));
    const en = seriesFor(allSessions.filter((s) => sessionLang(s) === 'en'));
    labels = fr.labels;
    stacked = true;
    legend = { display: true };
    datasets = [
      { label: `🇫🇷 ${t('french')}`, data: fr.data, backgroundColor: LANG_COLORS.fr, borderRadius: 4 },
      { label: `🇬🇧 ${t('english')}`, data: en.data, backgroundColor: LANG_COLORS.en, borderRadius: 4 },
    ];
  } else {
    const series = seriesFor(filteredSessions());
    labels = series.labels;
    // Keep the language's hue everywhere; goal-met periods just get a
    // deeper shade (green would look like the English color).
    const base = langFilter === 'fr' ? '43, 79, 216' : '22, 163, 74';
    const deep = `rgba(${base}, 0.95)`;
    const pale = `rgba(${base}, 0.4)`;
    datasets = [{
      label: t('minutesLabel'),
      data: series.data,
      backgroundColor: series.data.map((v) =>
        goalLine ? (v >= goalLine ? deep : pale) : `rgba(${base}, 0.75)`),
      borderRadius: 6,
    }];
    if (goalLine) {
      // Explain the shades: deep = goal met, pale = under goal.
      legend = {
        display: true,
        labels: {
          generateLabels: () => [
            { text: `${t('goalMet')} (≥ ${fmtMinutes(goalLine)})`, fillStyle: deep, strokeStyle: 'transparent' },
            { text: t('underGoal'), fillStyle: pale, strokeStyle: 'transparent' },
          ],
        },
      };
    }
  }

  if (mainChart) mainChart.destroy();
  mainChart = new Chart(document.getElementById('mainChart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend,
        title: { display: true, text: t(CHART_TITLES[currentView]), color: '#6b7280', font: { size: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMinutes(ctx.parsed.y)}` } },
      },
      scales: {
        y: { beginAtZero: true, stacked, ticks: { precision: 0 }, grid: { color: '#eef0f6' } },
        x: { stacked, grid: { display: false } },
      },
    },
  });
}

// First date included in the currently selected chart window.
function windowStartKey() {
  const now = logicalNow();
  if (currentView === 'daily') {
    now.setDate(now.getDate() - 13);
    return dateKey(now);
  }
  if (currentView === 'weekly') {
    const w = startOfWeek(now);
    w.setDate(w.getDate() - 7 * 11);
    return dateKey(w);
  }
  const base = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-01`;
}

function renderTypeChart() {
  const start = windowStartKey();
  const totals = { youtube: 0, podcast: 0, anki: 0, reading: 0 };
  for (const s of filteredSessions()) {
    if (s.date < start) continue;
    const key = totals[s.type] !== undefined ? s.type : 'youtube';
    totals[key] += s.seconds / 60;
  }

  if (typeChart) typeChart.destroy();
  typeChart = new Chart(document.getElementById('typeChart'), {
    type: 'doughnut',
    data: {
      labels: ['YouTube', 'Podcast', 'Anki', t('readingLbl')],
      datasets: [{
        data: [totals.youtube, totals.podcast, totals.anki, totals.reading].map(Math.round),
        backgroundColor: ['#ef4135', '#2b4fd8', '#f59e0b', '#8b5cf6'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right' },
        title: { display: true, text: t(CHART_TITLES[currentView]), color: '#6b7280', font: { size: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtMinutes(ctx.parsed)}` } },
      },
    },
  });
}

/* ── Render ───────────────────────────────── */
function render() {
  const stats = computeStats(filteredSessions());
  const goal = currentGoal();

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
    pct >= 100 ? t('goalDone') : `${Math.round(stats.today)} ${t('goalOf')} ${goal} ${t('goalUnit')}`;

  renderMainChart();
  renderTypeChart();
  renderSessionList();
}

const TYPE_META = {
  youtube: { icon: '▶️', label: 'YouTube' },
  podcast: { icon: '🎙️', label: 'Podcast' },
  reading: { icon: '📖', label: 'Reading' },
  anki: { icon: '📇', label: 'Anki' },
};

function sessionRow(s) {
  const li = document.createElement('li');
  li.className = 'session-item';

  const icon = document.createElement('span');
  icon.className = 'session-icon';
  icon.textContent = (TYPE_META[s.type] || TYPE_META.youtube).icon;
  li.appendChild(icon);

  const info = document.createElement('div');
  info.className = 'session-info';
  const title = document.createElement('div');
  title.className = 'session-title';
  title.textContent = s.title || t('untitled');
  const meta = document.createElement('div');
  meta.className = 'session-meta';
  const bits = [s.date];
  // Start–stop clock times, derived from the row's insert timestamp:
  // spotify rows are created at session start (then grown); the other live
  // trackers insert at session end. Anki/import/manual have no meaningful clock.
  if (s.created_at && ['auto', 'timer', 'apple', 'spotify'].includes(s.source)) {
    const created = new Date(s.created_at);
    const startMs = s.source === 'spotify' ? created.getTime() : created.getTime() - s.seconds * 1000;
    const endMs = s.source === 'spotify' ? created.getTime() + s.seconds * 1000 : created.getTime();
    const hm = (ms) => {
      const d = new Date(ms);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    bits.push(`${hm(startMs)}–${hm(endMs)}`);
  }
  if (s.channel) bits.push(s.channel);
  if (['auto', 'anki', 'apple', 'spotify'].includes(s.source)) bits.push('🤖 auto');
  if (s.source === 'import') bits.push('📥 est.');
  meta.textContent = bits.join(' · ');
  info.append(title, meta);

  const mins = document.createElement('span');
  mins.className = 'session-mins';
  mins.textContent = fmtMinutes(s.seconds / 60);

  const edit = document.createElement('button');
  edit.className = 'session-del';
  edit.textContent = '✏️';
  edit.title = 'Edit';
  edit.onclick = () => enterEditMode(li, s);

  const del = document.createElement('button');
  del.className = 'session-del';
  del.textContent = '✕';
  del.title = 'Delete';
  del.onclick = () => {
    if (confirm(t('confirmDelete'))) removeSession(s.id).catch(showError);
  };

  li.append(info, mins, edit, del);
  return li;
}

function enterEditMode(li, s) {
  li.innerHTML = '';
  li.className = 'session-item editing';

  const title = document.createElement('input');
  title.className = 'input grow';
  title.value = s.title || '';
  title.placeholder = t('titleOptional');

  const mins = document.createElement('input');
  mins.type = 'number';
  mins.className = 'input small';
  mins.min = '1';
  mins.max = '1440';
  mins.value = Math.max(1, Math.round(s.seconds / 60));

  const langSel = document.createElement('select');
  langSel.className = 'input';
  for (const code of ['fr', 'en']) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = LANG_FLAGS[code];
    langSel.appendChild(opt);
  }
  langSel.value = sessionLang(s);

  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = t('save');
  save.onclick = async () => {
    save.disabled = true;
    try {
      await sb.updateSession(s.id, {
        title: title.value.trim(),
        seconds: Math.max(60, parseInt(mins.value, 10) * 60 || s.seconds),
        language: langSel.value,
      });
      await fetchSessions();
      render();
    } catch (e) {
      showError(e);
      save.disabled = false;
    }
  };

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-secondary';
  cancel.textContent = t('cancel');
  cancel.onclick = () => render();

  li.append(title, mins, langSel, save, cancel);
}

function renderSessionList() {
  const list = document.getElementById('sessionList');
  const empty = document.getElementById('emptyMsg');
  list.innerHTML = '';
  const cutoff = logicalNow();
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffKey = dateKey(cutoff);
  const recent = filteredSessions().filter((s) => s.date >= cutoffKey);
  empty.style.display = recent.length ? 'none' : 'block';

  // Language sections, then collapsible per-source groups inside each.
  const langs = langFilter === 'all' ? ['fr', 'en'] : [langFilter];
  for (const lang of langs) {
    const ofLang = recent.filter((s) => sessionLang(s) === lang);
    if (!ofLang.length) continue;

    const header = document.createElement('li');
    header.className = 'lang-section';
    const langTotal = ofLang.reduce((sum, s) => sum + s.seconds, 0) / 60;
    header.innerHTML = `<span>${LANG_FLAGS[lang]} ${t(lang === 'fr' ? 'french' : 'english')}</span><span>${fmtMinutes(langTotal)}</span>`;
    list.appendChild(header);

    for (const type of Object.keys(TYPE_META)) {
      const group = ofLang.filter((s) => (TYPE_META[s.type] ? s.type : 'youtube') === type);
      if (!group.length) continue;

      const details = document.createElement('details');
      details.className = 'src-group';
      if (group.length <= 4) details.open = true;

      const summary = document.createElement('summary');
      const groupTotal = group.reduce((sum, s) => sum + s.seconds, 0) / 60;
      summary.innerHTML =
        `<span>${TYPE_META[type].icon} ${type === 'reading' ? t('readingLbl') : TYPE_META[type].label}</span>` +
        `<span class="src-sub">${group.length} ${t('sessionsUnit')} · ${fmtMinutes(groupTotal)}</span>`;
      details.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'session-list';
      for (const s of group) ul.appendChild(sessionRow(s));
      details.appendChild(ul);

      const wrap = document.createElement('li');
      wrap.appendChild(details);
      list.appendChild(wrap);
    }
  }
}

function showError(e) {
  const el = document.getElementById('errorMsg');
  el.textContent = `⚠ ${e.message || e}`;
  el.hidden = false;
}

/* ── CSV export ───────────────────────────── */
document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = [['date', 'minutes', 'language', 'type', 'title', 'channel', 'source']];
  for (const s of [...allSessions].reverse()) {
    rows.push([
      s.date,
      (s.seconds / 60).toFixed(1),
      sessionLang(s),
      s.type,
      `"${(s.title || '').replace(/"/g, '""')}"`,
      `"${(s.channel || '').replace(/"/g, '""')}"`,
      s.source,
    ]);
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `listening-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ── Settings ─────────────────────────────── */
function wireGoalInput(id, key) {
  const input = document.getElementById(id);
  input.addEventListener('change', async () => {
    const v = parseInt(input.value, 10);
    if (v >= 5) {
      goals[key] = v;
      await chrome.storage.sync.set({ goals });
      render();
    }
  });
}
wireGoalInput('goalInputFr', 'fr');
wireGoalInput('goalInputEn', 'en');

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    renderMainChart();
    renderTypeChart();
  });
});

document.querySelectorAll('[data-langfilter]').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('[data-langfilter]').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    langFilter = pill.dataset.langfilter;
    setUiLang(langFilter); // Français filter → French UI
    applyI18n();
    render();
  });
});

/* ── Init ─────────────────────────────────── */
(async function init() {
  applyI18n();

  const { goals: savedGoals } = await chrome.storage.sync.get('goals');
  if (savedGoals) goals = { fr: 30, en: 30, ...savedGoals };
  document.getElementById('goalInputFr').value = goals.fr;
  document.getElementById('goalInputEn').value = goals.en;

  try {
    await fetchSessions();
  } catch (e) {
    showError(e);
  }
  render();

  // Pick up freshly auto-tracked sessions while the tab stays open.
  setInterval(async () => {
    try {
      await fetchSessions();
      render();
    } catch { /* transient network error — keep showing stale data */ }
  }, 60000);
})();
