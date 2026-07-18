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

// On the "All" view the daily goal is only met once *both* languages have
// individually reached their own goal — a big French session doesn't cover
// for English (or vice versa).
function goalStatus(stats) {
  const tk = todayKey();
  if (langFilter === 'all') {
    const frToday = allSessions
      .filter((s) => s.date === tk && sessionLang(s) === 'fr')
      .reduce((sum, s) => sum + s.seconds / 60, 0);
    const enToday = allSessions
      .filter((s) => s.date === tk && sessionLang(s) === 'en')
      .reduce((sum, s) => sum + s.seconds / 60, 0);
    const frPct = goals.fr > 0 ? Math.min(1, frToday / goals.fr) : 1;
    const enPct = goals.en > 0 ? Math.min(1, enToday / goals.en) : 1;
    return {
      done: frToday >= goals.fr && enToday >= goals.en,
      pct: Math.min(frPct, enPct),
      frToday, enToday,
    };
  }
  const goal = goals[langFilter];
  return {
    done: stats.today >= goal,
    pct: goal > 0 ? Math.min(1, stats.today / goal) : 1,
  };
}

/* ── Data ─────────────────────────────────── */
async function fetchSessions() {
  allSessions = await sb.listSessions(
    'select=id,date,seconds,language,type,title,channel,source,season,episode,created_at&order=date.desc,created_at.desc&limit=5000'
  );
}

async function removeSession(id) {
  await sb.deleteSession(id);
  await fetchSessions();
  render();
}

/* ── Watch todo state ─────────────────────── */
// The session list doubles as a to-finish list: titled content groups across
// days into one row with a checkbox, and unchecked ("still watching") rows
// stay listed past the 7-day window until the user checks them off. State is
// one kv_state row like the trip checklist: { groupKey: 'todo' | 'done' }.
const WATCH_KEY = 'watch-todo';
let watchState = {};

async function loadWatchState() {
  try {
    const rows = await sbRequest(`kv_state?key=eq.${WATCH_KEY}&select=value`);
    if (rows.length) watchState = JSON.parse(rows[0].value);
  } catch {
    try { watchState = JSON.parse(localStorage.getItem(WATCH_KEY)) || {}; } catch { watchState = {}; }
  }
}

async function saveWatchState() {
  localStorage.setItem(WATCH_KEY, JSON.stringify(watchState));
  try {
    await sbRequest('kv_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: { key: WATCH_KEY, value: JSON.stringify(watchState), updated_at: new Date().toISOString() },
    });
  } catch { /* offline — localStorage keeps it until next save */ }
}

// Anki reviews are daily and never "complete", so they keep per-day rows.
const TODO_TYPES = ['youtube', 'podcast', 'reading', 'series'];
const normType = (s) => (TYPE_META[s.type] ? s.type : 'youtube');

function watchKey(s) {
  if (!s.title || !TODO_TYPES.includes(normType(s))) return null;
  const ep = s.type === 'series' && s.season && s.episode ? `S${s.season}E${s.episode}` : '';
  return `${sessionLang(s)}|${normType(s)}|${s.title}|${s.channel || ''}|${ep}`;
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
// Dashed reference line at the goal, so goal attainment is readable by
// position too, not by color alone.
const goalLinePlugin = {
  id: 'goalLine',
  afterDatasetsDraw(chart) {
    const value = chart.options.plugins.goalLine && chart.options.plugins.goalLine.value;
    if (!value) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y.getPixelForValue(value);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
};

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
  let goalMet = null; // per-bar goal status, single-language daily/weekly only
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
    // Single-language view: stack by source, matching the donut's colors.
    // Days that met the goal keep full color; missed days are washed out
    // (same hues, so the type identity survives). The dashed goal line and
    // the ✓ on met days keep the status readable without color.
    const sessions = filteredSessions();
    const TYPE_COLORS = { youtube: '#ef4135', podcast: '#2b4fd8', anki: '#f59e0b', reading: '#8b5cf6', series: '#14b8a6' };
    stacked = true;
    const perType = Object.keys(TYPE_META).map((type) => ({
      type,
      series: seriesFor(sessions.filter((s) => (TYPE_META[s.type] ? s.type : 'youtube') === type)),
    }));
    // Per-day color arrays make Chart.js paint legend chips with day 1's
    // color — pin them to the canonical type hues instead.
    legend = {
      display: true,
      labels: {
        generateLabels: (chart) => {
          const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
          for (const it of items) {
            const hue = TYPE_COLORS[perType[it.datasetIndex].type];
            it.fillStyle = hue;
            it.strokeStyle = hue;
          }
          return items;
        },
      },
    };
    labels = perType[0].series.labels;
    goalMet = goalLine
      ? labels.map((_, i) => perType.reduce((sum, p) => sum + p.series.data[i], 0) >= goalLine)
      : null;
    const faded = (hex) => hex + '59'; // same hue at ~35% alpha
    datasets = perType.map(({ type, series }) => ({
      label: `${TYPE_META[type].icon} ${typeLabel(type)}`,
      data: series.data,
      backgroundColor: goalMet
        ? series.data.map((_, i) => (goalMet[i] ? TYPE_COLORS[type] : faded(TYPE_COLORS[type])))
        : TYPE_COLORS[type],
      borderRadius: 3,
    }));
  }

  const lineValue = langFilter !== 'all' ? goalLine : null;
  if (mainChart) mainChart.destroy();
  mainChart = new Chart(document.getElementById('mainChart'), {
    type: 'bar',
    plugins: [goalLinePlugin],
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend,
        goalLine: { value: lineValue },
        title: { display: true, text: t(CHART_TITLES[currentView]), color: '#6b7280', font: { size: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtMinutes(ctx.parsed.y)}`,
            footer: (items) =>
              goalMet ? (goalMet[items[0].dataIndex] ? `✓ ${t('goalMetTip')}` : `✗ ${t('goalMissTip')}`) : '',
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          stacked,
          suggestedMax: lineValue || undefined,
          ticks: { precision: 0 },
          grid: { color: '#eef0f6' },
        },
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
  const totals = { youtube: 0, podcast: 0, anki: 0, reading: 0, series: 0 };
  for (const s of filteredSessions()) {
    if (s.date < start) continue;
    const key = totals[s.type] !== undefined ? s.type : 'youtube';
    totals[key] += s.seconds / 60;
  }

  if (typeChart) typeChart.destroy();
  typeChart = new Chart(document.getElementById('typeChart'), {
    type: 'doughnut',
    data: {
      labels: ['YouTube', 'Podcast', 'Anki', t('readingLbl'), t('seriesLbl')],
      datasets: [{
        data: [totals.youtube, totals.podcast, totals.anki, totals.reading, totals.series].map(Math.round),
        backgroundColor: ['#ef4135', '#2b4fd8', '#f59e0b', '#8b5cf6', '#14b8a6'],
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

  const gs = goalStatus(stats);
  const pct = Math.round(gs.pct * 100);
  const fill = document.getElementById('goalFill');
  fill.style.width = pct + '%';
  fill.classList.toggle('done', gs.done);
  document.getElementById('goalText').textContent = gs.done
    ? t('goalDone')
    : langFilter === 'all'
      ? `🇫🇷 ${Math.round(gs.frToday)}/${goals.fr} · 🇬🇧 ${Math.round(gs.enToday)}/${goals.en} ${t('goalUnit')}`
      : `${Math.round(stats.today)} ${t('goalOf')} ${goal} ${t('goalUnit')}`;

  renderMainChart();
  renderTypeChart();
  renderSessionList();
}

const TYPE_META = {
  youtube: { icon: '▶️', label: 'YouTube' },
  podcast: { icon: '🎙️', label: 'Podcast' },
  reading: { icon: '📖', label: 'Reading' },
  anki: { icon: '📇', label: 'Anki' },
  series: { icon: '📺', label: 'Series' },
};

// YouTube/Podcast/Anki are proper nouns and stay in English; Reading and
// Series are generic words, so they follow the UI's FR/EN language.
function typeLabel(type) {
  if (type === 'reading') return t('readingLbl');
  if (type === 'series') return t('seriesLbl');
  return TYPE_META[type].label;
}

const hm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Clock interval [startMs, endMs] for a row, or null when meaningless.
// Spotify rows are created at session start (then grown); the other live
// trackers insert at session end. Anki/import/manual have no useful clock.
function sessionInterval(s) {
  if (!s.created_at || !['auto', 'timer', 'apple', 'spotify'].includes(s.source)) return null;
  const created = new Date(s.created_at).getTime();
  return s.source === 'spotify'
    ? [created, created + s.seconds * 1000]
    : [created - s.seconds * 1000, created];
}

// Union overlapping/adjacent (≤2 min apart) intervals.
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 120000) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

// One list item for a group of rows (same content, same day; often length 1).
function sessionRow(rows) {
  const s = rows[0];
  const li = document.createElement('li');
  li.className = 'session-item';

  const k = watchKey(s);
  if (k) {
    if (watchState[k] === 'done') li.classList.add('done');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'session-check';
    box.title = 'Done?';
    box.checked = watchState[k] === 'done';
    box.onchange = () => {
      watchState[k] = box.checked ? 'done' : 'todo';
      li.classList.toggle('done', box.checked);
      saveWatchState();
    };
    li.appendChild(box);
  }

  const icon = document.createElement('span');
  icon.className = 'session-icon';
  icon.textContent = (TYPE_META[s.type] || TYPE_META.youtube).icon;
  li.appendChild(icon);
  // Series rows upgrade the generic 📺 to the show's TMDB poster once it
  // resolves; the emoji stays when there's no key, no match, or no artwork.
  if (s.type === 'series' && s.channel) {
    seriesPoster(s.channel).then((url) => {
      if (!url) return;
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      icon.textContent = '';
      icon.appendChild(img);
    });
  }

  const info = document.createElement('div');
  info.className = 'session-info';
  const title = document.createElement('div');
  title.className = 'session-title';
  const episodeTag = s.type === 'series' && s.season && s.episode ? `S${s.season}E${s.episode} · ` : '';
  title.textContent = episodeTag + (s.title || t('untitled'));
  const meta = document.createElement('div');
  meta.className = 'session-meta';
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const bits = [dates.length > 1 ? `${dates[0]} → ${dates[dates.length - 1]}` : s.date];
  // Clock ranges only make sense within a single day.
  const intervals = dates.length > 1 ? [] : mergeIntervals(rows.map(sessionInterval).filter(Boolean));
  if (intervals.length) {
    bits.push(intervals.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', '));
  }
  if (s.channel) bits.push(s.channel);
  if (rows.some((r) => ['auto', 'anki', 'apple', 'spotify'].includes(r.source))) bits.push('🤖 auto');
  if (rows.some((r) => r.source === 'import')) bits.push('📥 est.');
  meta.textContent = bits.join(' · ');
  info.append(title, meta);

  const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0);
  const mins = document.createElement('span');
  mins.className = 'session-mins';
  mins.textContent = fmtMinutes(totalSeconds / 60);

  if (rows.length === 1) {
    const edit = document.createElement('button');
    edit.className = 'session-del';
    edit.textContent = '✏️';
    edit.title = 'Edit';
    edit.onclick = () => enterEditMode(li, s);
    li.append(info, mins, edit);
  } else {
    li.append(info, mins);
  }

  const del = document.createElement('button');
  del.className = 'session-del';
  del.textContent = '✕';
  del.title = rows.length > 1 ? `Delete ${rows.length} sessions` : 'Delete';
  del.onclick = async () => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      for (const r of rows) await sb.deleteSession(r.id);
      await fetchSessions();
      render();
    } catch (e) {
      showError(e);
    }
  };
  li.appendChild(del);
  return li;
}

// Rows sharing a non-empty title + channel on the same day render as one item.
// One in-flight/settled promise per series per page load — the list can
// hold many rows of the same show, and tmdbShowPoster's storage cache is
// still an async round-trip each call.
const posterMemo = new Map();
function seriesPoster(name) {
  if (!posterMemo.has(name)) posterMemo.set(name, tmdbShowPoster(name));
  return posterMemo.get(name);
}

// Todo-able content groups by title across days; anki keeps per-day rows;
// untitled rows stay solo.
function groupSameContent(sessions) {
  const byKey = new Map();
  for (const s of sessions) {
    const k = watchKey(s) || (s.title ? `${s.date}|${s.title}|${s.channel}` : `solo|${s.id}`);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  return [...byKey.values()];
}

function enterEditMode(li, s) {
  li.innerHTML = '';
  li.className = 'session-item editing';

  const title = document.createElement('input');
  title.className = 'input grow';
  title.value = s.title || '';
  title.placeholder = t('titleRequired');

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
    if (!title.value.trim()) { title.focus(); return; } // title is mandatory
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

  // Unfinished content stays on the list past the window until checked off.
  const inWindow = new Set(recent.map((s) => s.id));
  const pinned = filteredSessions().filter(
    (s) => !inWindow.has(s.id) && watchState[watchKey(s)] === 'todo'
  );
  const shown = recent.concat(pinned);
  empty.style.display = shown.length ? 'none' : 'block';

  // New titled content starts as 'todo' so it survives the window later —
  // except series episodes (logged manually as complete viewings) and
  // Shorts binges (scrolled through, nothing to resume), which start
  // 'done' (uncheck one to pin it as unfinished);
  // entries whose sessions are all gone (deleted or checked off and aged
  // out) are dropped. Only prune on the unfiltered view, where every
  // language's sessions are present to vouch for their entries.
  let dirty = false;
  for (const s of recent) {
    const k = watchKey(s);
    if (k && !watchState[k]) {
      const startsDone = normType(s) === 'series' || s.channel === 'Shorts';
      watchState[k] = startsDone ? 'done' : 'todo';
      dirty = true;
    }
  }
  if (langFilter === 'all') {
    const live = new Set(shown.map(watchKey).filter(Boolean));
    for (const k of Object.keys(watchState)) {
      if (!live.has(k)) { delete watchState[k]; dirty = true; }
    }
  }
  if (dirty) saveWatchState();

  // Language sections, then collapsible per-source groups inside each.
  const langs = langFilter === 'all' ? ['fr', 'en'] : [langFilter];
  for (const lang of langs) {
    const ofLang = shown.filter((s) => sessionLang(s) === lang);
    if (!ofLang.length) continue;

    const header = document.createElement('li');
    header.className = 'lang-section';
    const langTotal = ofLang.reduce((sum, s) => sum + s.seconds, 0) / 60;
    header.innerHTML = `<span>${LANG_FLAGS[lang]} ${t(lang === 'fr' ? 'french' : 'english')}</span><span>${fmtMinutes(langTotal)}</span>`;
    list.appendChild(header);

    for (const type of Object.keys(TYPE_META)) {
      const group = ofLang.filter((s) => (TYPE_META[s.type] ? s.type : 'youtube') === type);
      if (!group.length) continue;

      const merged = groupSameContent(group);
      const details = document.createElement('details');
      details.className = 'src-group';
      if (merged.length <= 4) details.open = true;

      const summary = document.createElement('summary');
      const groupTotal = group.reduce((sum, s) => sum + s.seconds, 0) / 60;
      summary.innerHTML =
        `<span>${TYPE_META[type].icon} ${typeLabel(type)}</span>` +
        `<span class="src-sub">${merged.length} ${t('sessionsUnit')} · ${fmtMinutes(groupTotal)}</span>`;
      details.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'session-list';
      for (const rows of merged) ul.appendChild(sessionRow(rows));
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
  const rows = [['date', 'minutes', 'language', 'type', 'title', 'channel', 'source', 'season', 'episode']];
  for (const s of [...allSessions].reverse()) {
    rows.push([
      s.date,
      (s.seconds / 60).toFixed(1),
      sessionLang(s),
      s.type,
      `"${(s.title || '').replace(/"/g, '""')}"`,
      `"${(s.channel || '').replace(/"/g, '""')}"`,
      s.source,
      s.season ?? '',
      s.episode ?? '',
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

  // Series posters need a TMDB key. The extension always has one
  // (config.local.js or the popup-saved key), but the GitHub Pages copy
  // can't — the key is personal and the repo is public — so offer a field
  // there that stores it in this browser's localStorage via the shim.
  const tmdbInput = document.getElementById('tmdbKeyInput');
  tmdbInput.hidden = !!(await tmdbGetApiKey());
  tmdbInput.addEventListener('change', async () => {
    const key = tmdbInput.value.trim();
    if (!key) return;
    await tmdbSetApiKey(key);
    tmdbInput.hidden = true;
    posterMemo.clear();
    render();
  });

  try {
    await Promise.all([fetchSessions(), loadWatchState()]);
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
