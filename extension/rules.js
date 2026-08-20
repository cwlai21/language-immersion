// Pure decision logic shared by the dashboard (loaded as a <script> tag,
// browser globals) and its Node test suite (test/rules.test.js, via
// require()). Dependency-free like lang-detect.js — no DOM, no chrome.*,
// no network, so it can run anywhere.

// ── Date/window helpers ─────────────────────
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The tracker's day starts at 4am (like Anki's rollover), so "today" and all
// chart windows shift the clock back four hours. Takes an optional `now` so
// tests can pin the clock instead of depending on Date.now().
const ROLLOVER_HOUR = 4;
const logicalNow = (now = new Date()) => new Date(now.getTime() - ROLLOVER_HOUR * 3600 * 1000);
const todayKey = (now = new Date()) => dateKey(logicalNow(now));

// Most recent Monday at/before d — the recent-sessions list and the weekly
// chart both reset on this day rather than rolling a fixed 7-day window.
function startOfWeek(d) {
  const out = new Date(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  out.setHours(0, 0, 0, 0);
  return out;
}

// ── Session-stats aggregation ────────────────
// Shared by the dashboard (charts, stats cards) and the popup (quick
// today/week/month totals) — the two used to compute this by hand,
// independently, and had already drifted on goal-percent rounding.
function minutesByDate(sessions) {
  const map = {};
  for (const s of sessions) map[s.date] = (map[s.date] || 0) + s.seconds / 60;
  return map;
}

function computeStats(sessions, rawNow = new Date()) {
  const byDate = minutesByDate(sessions);
  const now = logicalNow(rawNow);
  const today = byDate[todayKey(rawNow)] || 0;

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
  const cursor = logicalNow(rawNow);
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

// ── Session shape helpers ───────────────────
function sessionLang(s) {
  return s.language === 'en' ? 'en' : 'fr';
}

// Keep this in sync with TYPE_META's keys in dashboard.js.
const KNOWN_TYPES = ['youtube', 'podcast', 'reading', 'anki', 'series'];
const normType = (s) => (KNOWN_TYPES.includes(s.type) ? s.type : 'youtube');

// Anki reviews are daily and never "complete", so they keep per-day rows
// instead of getting a todo entry.
const TODO_TYPES = ['youtube', 'podcast', 'reading', 'series'];

function watchKey(s) {
  if (!s.title || !TODO_TYPES.includes(normType(s))) return null;
  const ep = s.type === 'series' && s.season && s.episode ? `S${s.season}E${s.episode}` : '';
  return `${sessionLang(s)}|${normType(s)}|${s.title}|${s.channel || ''}|${ep}`;
}

// New titled content starts as 'todo' so it survives the window later —
// except Shorts binges (scrolled through, nothing to resume), which start
// 'done' (uncheck one to pin it as unfinished). Auto-detected episodes, in
// either language, stay 'todo' like everything else: finishing one is worth
// actively checking off. A manually-entered youtube/podcast/series episode
// is different — typing it in after the fact only happens once you've
// actually watched or listened to it, so it starts 'done'. Reading is the
// exception: every reading session is logged by hand (no auto-detection
// exists for it), so 'manual' there just means "an ordinary reading
// session," not "finished the book" — it still starts 'todo'.
function startsDone(s) {
  return s.channel === 'Shorts' || (normType(s) !== 'reading' && s.source === 'manual');
}

// ── Watch-todo state transitions ────────────
// Fill in a default state for any recent item that doesn't have one yet.
// Pure — returns { state, changed } and never mutates watchState.
function assignDefaultStates(watchState, recentSessions) {
  const state = { ...watchState };
  let changed = false;
  for (const s of recentSessions) {
    const k = watchKey(s);
    if (k && !state[k]) {
      state[k] = startsDone(s) ? 'done' : 'todo';
      changed = true;
    }
  }
  return { state, changed };
}

// Forget a key only once none of its sessions exist anywhere (genuinely
// deleted) — never just because its content scrolled outside the display
// window. That distinction is the fix for a real bug: a hard weekly window
// reset used to drop a whole week of 'done' marks at once (pruned as
// "not currently shown"), where the old rolling 7-day window only ever
// aged content out one day at a time and never noticeably lost data.
function pruneDeadKeys(watchState, allSessions) {
  const live = new Set(allSessions.map(watchKey).filter(Boolean));
  const state = {};
  let changed = false;
  for (const [k, v] of Object.entries(watchState)) {
    if (live.has(k)) state[k] = v;
    else changed = true;
  }
  return { state, changed };
}

// ── Goal status ──────────────────────────────
// On the "All" view the daily goal is only met once *both* languages have
// individually reached their own goal — a big French session doesn't cover
// for English (or vice versa), so this is deliberately not "combined total
// >= combined goal".
function goalStatusAll(goals, frToday, enToday) {
  const frPct = goals.fr > 0 ? Math.min(1, frToday / goals.fr) : 1;
  const enPct = goals.en > 0 ? Math.min(1, enToday / goals.en) : 1;
  return {
    done: frToday >= goals.fr && enToday >= goals.en,
    pct: Math.min(frPct, enPct),
    frToday, enToday,
  };
}

function goalStatusSingle(goal, today) {
  return {
    done: today >= goal,
    pct: goal > 0 ? Math.min(1, today / goal) : 1,
  };
}

// The goal-streak card measures against this flat baseline, not the current
// daily goal, on purpose: raising the daily goal (e.g. 30 → 60) shouldn't
// retroactively break a long run of days that cleared the original target.
// It reads as "days you kept the habit up" rather than "days you hit today's
// number", so the streak survives a goal bump.
const STREAK_GOAL_MIN = 30;

// How many days in a row the streak baseline has been met, counting back from
// today. `filter` follows the dashboard's language filter: 'fr'/'en' check
// that one language; 'all' requires *both* languages to clear the baseline
// that day. Today not yet meeting it doesn't break the streak — like the
// plain day streak, it counts from yesterday in that case, so an in-progress
// day never reads as a reset. `now` and `threshold` are injectable for tests.
function goalStreak(sessions, filter, rawNow = new Date(), threshold = STREAK_GOAL_MIN) {
  const byDay = {}; // { date: { fr: minutes, en: minutes } }
  for (const s of sessions) {
    const bucket = byDay[s.date] || (byDay[s.date] = { fr: 0, en: 0 });
    bucket[sessionLang(s)] += s.seconds / 60;
  }
  const met = (date) => {
    const m = byDay[date];
    if (!m) return false; // a day with no listening never counts
    if (filter === 'fr') return m.fr >= threshold;
    if (filter === 'en') return m.en >= threshold;
    return m.fr >= threshold && m.en >= threshold;
  };
  let streak = 0;
  const cursor = logicalNow(rawNow);
  if (!met(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (met(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Dual browser/Node: a plain <script> tag in dashboard.html defines these as
// globals (like lang-detect.js); require('./rules.js') in tests gets them
// via module.exports. Neither environment sees the other's branch.
if (typeof module !== 'undefined') {
  module.exports = {
    pad, dateKey, ROLLOVER_HOUR, logicalNow, todayKey, startOfWeek,
    minutesByDate, computeStats,
    sessionLang, KNOWN_TYPES, normType, TODO_TYPES, watchKey, startsDone,
    assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
    STREAK_GOAL_MIN, goalStreak,
  };
}
