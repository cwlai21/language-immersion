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
// 'done' (uncheck one to pin it as unfinished). Auto-detected series
// episodes, in either language, stay 'todo' like everything else:
// finishing an episode is worth actively checking off. A manually-entered
// series episode is different — typing it in after the fact only happens
// once you've actually watched it, so it starts 'done'.
function startsDone(s) {
  return s.channel === 'Shorts' || (normType(s) === 'series' && s.source === 'manual');
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

// Dual browser/Node: a plain <script> tag in dashboard.html defines these as
// globals (like lang-detect.js); require('./rules.js') in tests gets them
// via module.exports. Neither environment sees the other's branch.
if (typeof module !== 'undefined') {
  module.exports = {
    pad, dateKey, ROLLOVER_HOUR, logicalNow, todayKey, startOfWeek,
    sessionLang, KNOWN_TYPES, normType, TODO_TYPES, watchKey, startsDone,
    assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
  };
}
