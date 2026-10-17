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
  // The 4am day, not the calendar date. A video finished at 01:30 read as
  // "hier" the day before — showing it as the 28th afterwards would have the
  // same evening answering to two different dates.
  const when = logicalNow(new Date(doneAt));
  const options = { day: 'numeric', month: 'short' };
  if (when.getFullYear() !== logicalNow(now).getFullYear()) options.year = 'numeric';
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

// What a row is *about*, for grouping its sittings into one item and for
// remembering whether that item is watched. A video id is the thing itself;
// a title is only what it was called at the time. Finary renamed "Le seul
// cours d'économie dont vous aurez besoin (99 % ne l'ont jamais eu)" to drop
// its parenthesis mid-way through being watched, and the same 28 minutes
// split into two dashboard entries with two checkboxes. Podcasts, books and
// series episodes have no id, so they keep the title.
function watchKey(s) {
  if (!TODO_TYPES.includes(normType(s))) return null;
  if (s.video_id) return `${sessionLang(s)}|${normType(s)}|v:${s.video_id}`;
  return legacyWatchKey(s);
}

// The title-based key exactly as it was before ids were used. Stored watch
// states are keyed by whatever watchKey returned when they were written, so
// this is how migrateWatchKeys finds them.
function legacyWatchKey(s) {
  if (!s.title || !TODO_TYPES.includes(normType(s))) return null;
  const ep = s.type === 'series' && s.season && s.episode ? `S${s.season}E${s.episode}` : '';
  return `${sessionLang(s)}|${normType(s)}|${s.title}|${s.channel || ''}|${ep}`;
}

// One-time rewrite of stored watch-todo state onto the new keys. Without it,
// every ticked video would look like an unknown key — pruned as dead, and its
// content re-offered as unwatched. Runs on every load and is a no-op once
// there is nothing left in the old shape.
//
// 'done' wins a collision: a rename can leave two stored keys for one video
// (the old title and the new), and having watched it is the fact that
// matters — re-offering something already finished is the worse mistake.
function migrateWatchKeys(watchState, allSessions) {
  const rename = new Map();
  for (const s of allSessions || []) {
    const now = watchKey(s);
    const was = legacyWatchKey(s);
    if (now && was && now !== was) rename.set(was, now);
  }
  const state = {};
  let changed = false;
  for (const [key, value] of Object.entries(watchState || {})) {
    const target = rename.get(key);
    if (!target) { state[key] = state[key] || value; continue; }
    changed = true;
    state[target] = state[target] === 'done' || value === 'done' ? 'done' : value;
  }
  return { state, changed };
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
 * The trip pages curate their items by hand, so they can't key them the
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
    // Both spellings of the key count: the dashboard rewrites stored state
    // onto ids when it next loads (migrateWatchKeys), and until it does, a
    // tick written under the old title key is still a tick.
    const keys = [
      ...sessionWatchKeys(matched),
      ...matched.map(legacyWatchKey).filter(Boolean),
    ];
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
// `todayRows` are today's sessions, so the ring can agree with the streak: a
// travelling day (vacationDay) is done on its own terms rather than on
// minutes. It is reported as `vacation` rather than folded into `done`, so the
// page can say which of the two it was instead of claiming a goal was hit.
function goalStatusAll(goals, frToday, enToday, todayRows) {
  const frPct = goals.fr > 0 ? Math.min(1, frToday / goals.fr) : 1;
  const enPct = goals.en > 0 ? Math.min(1, enToday / goals.en) : 1;
  const vacation = vacationDay(todayRows);
  return {
    done: vacation || (frToday >= goals.fr && enToday >= goals.en),
    pct: vacation ? 1 : Math.min(frPct, enPct),
    vacation,
    frToday, enToday,
  };
}

function goalStatusSingle(goal, today, todayRows) {
  const vacation = vacationDay(todayRows);
  return {
    done: vacation || today >= goal,
    pct: vacation ? 1 : (goal > 0 ? Math.min(1, today / goal) : 1),
    vacation,
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

// How much YouTube and series a travelling day tolerates. Not zero: away from
// the desk you still open the odd thing on a phone, and the rule was written
// in terms of habits rather than abstinence. Three minutes and forty seconds
// of tennis highlights on 11 Oct 2026 disqualified a day of reading and Anki
// under a zero-tolerance reading, and took a 72-day streak with it. A quarter
// of an hour is short enough that it cannot be a sit-down session and long
// enough to cover a clip or two.
const VACATION_SCREEN_LIMIT_MIN = 15;

// A day away from the desk rather than a day off. YouTube and series are the
// sit-down habits; a day with no real amount of either is a day travelling,
// and the minutes threshold is the wrong question to ask of it. What is asked
// instead is whether the day still did the work that travels: reading in both
// languages, and the French deck reviewed.
//
// Podcasts don't count toward the screen limit — they travel too. Anything
// the type field doesn't recognise counts as YouTube (normType), so an
// unexpected row eats into the allowance rather than being waved through.
function vacationDay(rows, screenLimitMin = VACATION_SCREEN_LIMIT_MIN) {
  if (!rows || !rows.length) return false;
  const screenMinutes = rows
    .filter((s) => normType(s) === 'youtube' || normType(s) === 'series')
    .reduce((sum, s) => sum + s.seconds / 60, 0);
  if (screenMinutes > screenLimitMin) return false;
  const has = (type, lang) => rows.some((s) => normType(s) === type && sessionLang(s) === lang);
  return has('reading', 'fr') && has('reading', 'en') && has('anki', 'fr');
}

// Two missed days a month are forgiven. A travelling day already holds the
// streak, but only because real work happened on it — reading in both
// languages and the French deck. That leaves no room for a day that is simply
// a day off: ill, a long flight, a birthday. Zero tolerance for those makes
// the streak a record of luck as much as habit, and the only way to protect a
// long run becomes never living a normal life.
//
// Two is deliberately small. It is enough to survive a bad week without being
// enough to coast: a third missed day in the same month still ends the run.
const MONTHLY_BREAK_ALLOWANCE = 2;

// Calendar month, resetting on the 1st — the allowance is meant to be countable
// in your head ("I've used one this month"), which a rolling window is not.
// The cost is a seam at month end: two breaks on the 31st and two on the 1st
// are all forgiven. That is accepted as the price of a rule you can predict.
function breakMonth(date) {
  return date.slice(0, 7); // YYYY-MM
}

// How many days in a row the goal has been met, counting back from today.
// `filter` follows the dashboard's language filter: 'fr'/'en' check that one
// language; 'all' requires *both* languages to clear the goal that day. Today
// not yet meeting it doesn't break the streak — like the plain day streak, it
// counts from yesterday in that case, so an in-progress day never reads as a
// reset. Each day is judged against the goal active on that date (see
// streakThreshold).
//
// A missed day inside the monthly allowance holds the chain but does NOT add
// to the count: the number keeps meaning "days I did the work". A run of ten
// days containing one break reads as nine, not ten.
//
// `now`, `thresholdFor` and `allowance` are injectable for tests.
function goalStreak(sessions, filter, rawNow = new Date(), thresholdFor = streakThreshold,
                    allowance = MONTHLY_BREAK_ALLOWANCE) {
  const byDay = {}; // { date: { fr: minutes, en: minutes, rows } }
  for (const s of sessions) {
    const bucket = byDay[s.date] || (byDay[s.date] = { fr: 0, en: 0, rows: [] });
    bucket[sessionLang(s)] += s.seconds / 60;
    bucket.rows.push(s);
  }
  const met = (date) => {
    const m = byDay[date];
    if (!m) return false; // a day with no listening never counts
    // A travelling day holds the streak on its own terms, whichever language
    // the dashboard is filtered to: the rule already asks for both of them.
    if (vacationDay(m.rows)) return true;
    const threshold = thresholdFor(date);
    if (filter === 'fr') return m.fr >= threshold;
    if (filter === 'en') return m.en >= threshold;
    return m.fr >= threshold && m.en >= threshold;
  };

  // Nothing before the first tracked day is a break — it is prehistory. Without
  // this the walk would forgive its way two days past the very first session
  // and report a streak that began before any listening did.
  let firstDate = null;
  for (const date in byDay) {
    if (firstDate === null || date < firstDate) firstDate = date;
  }

  const spent = {}; // { 'YYYY-MM': days forgiven so far }
  const forgive = (date) => {
    if (!firstDate || date < firstDate) return false;
    const m = breakMonth(date);
    if ((spent[m] || 0) >= allowance) return false;
    spent[m] = (spent[m] || 0) + 1;
    return true;
  };

  let streak = 0;
  const cursor = logicalNow(rawNow);
  // An in-progress today is skipped, not forgiven: it has not failed yet, so
  // it must not cost one of the month's two breaks.
  if (!met(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const date = dateKey(cursor);
    if (met(date)) streak++;
    else if (!forgive(date)) break;
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
    sessionLang, KNOWN_TYPES, normType, TODO_TYPES, watchKey, legacyWatchKey, migrateWatchKeys,
    sessionWatchKeys, startsDone,
    videoIdFromUrl, normShow, contentLinks, doneItemIds,
    withDoneAt, compareWatchlist, doneAtLabel,
    assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
    vacationDay, VACATION_SCREEN_LIMIT_MIN,
    STREAK_GOAL_HISTORY, streakThreshold, goalStreak,
    MONTHLY_BREAK_ALLOWANCE, breakMonth,
  };
}
