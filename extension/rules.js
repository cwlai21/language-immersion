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

// ── À regarder: finishing a video ────────────

// A video-todo entry records when it was ticked, so the list can show it and
// order by it. Unticking clears the stamp: it isn't finished any more, and a
// stale time would sort it as though it were.
function withDoneAt(entry, done, now = Date.now()) {
  const next = { ...(entry || {}), done: !!done };
  if (done) next.doneAt = now;
  else delete next.doneAt;
  return next;
}

// Still to watch first, newest addition first — watched videos import
// pre-ticked with addedAt of "now", so a plain newest-first sort would pile
// them on top of what you actually still want to watch. Finished ones follow,
// most recently finished first. Entries ticked before doneAt existed have no
// stamp; they keep to the end of the finished half, ordered by when they were
// added, rather than jumping to the top as if just watched.
function compareWatchlist(a, b) {
  if (!!a.done !== !!b.done) return (a.done ? 1 : 0) - (b.done ? 1 : 0);
  if (a.done) {
    const byFinished = (b.doneAt || 0) - (a.doneAt || 0);
    if (byFinished) return byFinished;
  }
  return (b.addedAt || 0) - (a.addedAt || 0);
}

// When a video was finished, for the list: "aujourd'hui", "hier", or a short
// date. Bucketed on the tracker's 4am day like everything else, so finishing
// something at 2am reads as last night rather than today.
function doneAtLabel(doneAt, now = new Date()) {
  if (!doneAt) return '';
  const day = dateKey(logicalNow(new Date(doneAt)));
  if (day === todayKey(now)) return "aujourd'hui";
  const yesterday = logicalNow(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dateKey(yesterday)) return 'hier';
  const when = new Date(doneAt);
  const options = { day: 'numeric', month: 'short' };
  if (when.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return when.toLocaleDateString('fr-FR', options);
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

// The distinct watch-todo keys a set of session rows belongs to. One video can
// have several rows (a pause splits a viewing in two), and the dashboard groups
// them into a single checkbox, so ticking that video means ticking one key —
// but a title watched in both languages is genuinely two. Rows with no key
// (untitled, or a type with no checkbox like anki) drop out.
function sessionWatchKeys(rows) {
  return [...new Set((rows || []).map(watchKey).filter(Boolean))];
}

/* ── Linking a curated list to what was actually watched ─────
 *
 * Pages like ✈️ Voyage curate their items by hand, so they can't key them the
 * way the dashboard does — a curated item exists long before any session. What
 * the two ends do share is what a session records about the thing itself: a
 * YouTube video id, or, for a podcast, the show in `channel`. An item declares
 * whichever it has and these functions do the matching, so a page only has to
 * describe its items, not know how any other list is keyed. */

// The YouTube video id in a watch / share / embed URL, or '' when there is
// none to find — a search link, a podcast page, a plain article.
function videoIdFromUrl(url) {
  const m = String(url || '').match(
    /(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]+)/,
  );
  return m ? m[1] : '';
}

// Show names arrive from two different hands — typed into a curated list here,
// written by whatever the podcast tracker read from Spotify or Apple there —
// so compare them loosely. Case, accents, curly apostrophes and surrounding
// space are all noise; a real difference in the name is not.
function normShow(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

// What a curated item can be matched by. Both are lists because an item may
// legitimately be neither (a search link — nothing to match, and that is not
// an error) or, later, more than one.
function contentLinks(item) {
  const videoId = videoIdFromUrl(item && item.url);
  const show = normShow(item && item.show);
  return { videoIds: videoId ? [videoId] : [], shows: show ? [show] : [] };
}

// Which of `items` the other lists already consider finished.
//
// `rows` are the session rows that could possibly match (fetched by video id,
// plus the podcast rows), `watchlist` is the À regarder kv doc keyed by video
// id, `watchTodo` the dashboard's keyed by watchKey. An item counts as done if
// À regarder has it ticked, or if any session it matches is ticked on the
// dashboard — *any*, because one finished episode answers "have I got to this
// show yet?", which is what a curated item asks.
function doneItemIds(items, rows, watchlist, watchTodo) {
  const byVideo = new Map();
  const byShow = new Map();
  for (const r of rows || []) {
    if (r.video_id) {
      if (!byVideo.has(r.video_id)) byVideo.set(r.video_id, []);
      byVideo.get(r.video_id).push(r);
    }
    const show = normShow(r.channel);
    if (show) {
      if (!byShow.has(show)) byShow.set(show, []);
      byShow.get(show).push(r);
    }
  }
  const done = new Set();
  for (const item of items || []) {
    const { videoIds, shows } = contentLinks(item);
    if (videoIds.some((v) => (watchlist || {})[v] && (watchlist || {})[v].done)) {
      done.add(item.id);
      continue;
    }
    const matched = [
      ...videoIds.flatMap((v) => byVideo.get(v) || []),
      ...shows.flatMap((sh) => byShow.get(sh) || []),
    ];
    const keys = sessionWatchKeys(matched);
    if (keys.some((k) => (watchTodo || {})[k] === 'done')) done.add(item.id);
  }
  return done;
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
// The daily goal (both languages) over time, in minutes — periods sorted
// newest-first. It started at 30 and was raised to 60 on 2026-08-08. The goal
// streak judges each day against the goal that was in effect *that* day, so
// raising the goal never retroactively breaks a run of days that cleared the
// earlier target. Add a period here whenever the goal changes again.
const STREAK_GOAL_HISTORY = [
  { from: '2026-08-08', min: 60 },
  { from: '0000-00-00', min: 30 },
];

// The streak goal (minutes) in effect on a given YYYY-MM-DD.
function streakThreshold(date) {
  for (const period of STREAK_GOAL_HISTORY) {
    if (date >= period.from) return period.min;
  }
  return STREAK_GOAL_HISTORY[STREAK_GOAL_HISTORY.length - 1].min;
}

// How many days in a row the goal has been met, counting back from today.
// `filter` follows the dashboard's language filter: 'fr'/'en' check that one
// language; 'all' requires *both* languages to clear the goal that day. Today
// not yet meeting it doesn't break the streak — like the plain day streak, it
// counts from yesterday in that case, so an in-progress day never reads as a
// reset. Each day is judged against the goal active on that date (see
// streakThreshold). `now` and `thresholdFor` are injectable for tests.
function goalStreak(sessions, filter, rawNow = new Date(), thresholdFor = streakThreshold) {
  const byDay = {}; // { date: { fr: minutes, en: minutes } }
  for (const s of sessions) {
    const bucket = byDay[s.date] || (byDay[s.date] = { fr: 0, en: 0 });
    bucket[sessionLang(s)] += s.seconds / 60;
  }
  const met = (date) => {
    const m = byDay[date];
    if (!m) return false; // a day with no listening never counts
    const threshold = thresholdFor(date);
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
    sessionLang, KNOWN_TYPES, normType, TODO_TYPES, watchKey, sessionWatchKeys, startsDone,
    videoIdFromUrl, normShow, contentLinks, doneItemIds,
    withDoneAt, compareWatchlist, doneAtLabel,
    assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
    STREAK_GOAL_HISTORY, streakThreshold, goalStreak,
  };
}
