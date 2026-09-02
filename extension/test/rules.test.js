// Sanity suite for extension/rules.js — the pure decision logic behind the
// dashboard's window reset, watch-todo checklist, and daily goal math. Run
// with `node --test extension/test` (see .githooks/pre-commit, pre-push).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dateKey, logicalNow, todayKey, startOfWeek,
  minutesByDate, computeStats,
  sessionLang, normType, watchKey, sessionWatchKeys, startsDone,
  videoIdFromUrl, normShow, contentLinks, doneItemIds,
  assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
  streakThreshold, goalStreak,
} = require('../rules.js');

const min = (m) => m * 60; // minutes -> seconds, for session fixtures

/* ── startOfWeek: every weekday resets to that week's Monday ── */
test('startOfWeek resets to Monday for every day of the week', () => {
  // 2026-07-20 is a Monday; 2026-07-19 the Sunday before it.
  const cases = [
    ['2026-07-20', '2026-07-20'], // Monday -> itself
    ['2026-07-21', '2026-07-20'], // Tuesday
    ['2026-07-22', '2026-07-20'], // Wednesday
    ['2026-07-23', '2026-07-20'], // Thursday
    ['2026-07-24', '2026-07-20'], // Friday
    ['2026-07-25', '2026-07-20'], // Saturday
    ['2026-07-26', '2026-07-20'], // Sunday -> the Monday that started its week
  ];
  for (const [input, expected] of cases) {
    const got = dateKey(startOfWeek(new Date(`${input}T12:00:00`)));
    assert.equal(got, expected, `${input} should resolve to week start ${expected}`);
  }
});

test('startOfWeek zeroes the time of day', () => {
  const d = startOfWeek(new Date('2026-07-23T18:45:00'));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

/* ── logicalNow / todayKey: 4am rollover ── */
test('logicalNow keeps the previous calendar day before the 4am rollover', () => {
  const beforeRollover = new Date('2026-07-21T02:00:00');
  assert.equal(todayKey(beforeRollover), '2026-07-20');
});

test('logicalNow advances to the new day after the 4am rollover', () => {
  const afterRollover = new Date('2026-07-21T05:00:00');
  assert.equal(todayKey(afterRollover), '2026-07-21');
});

/* ── watchKey: which sessions get a checklist entry ── */
test('watchKey groups a series episode by show + season + episode', () => {
  const s = { language: 'en', type: 'series', title: 'Devil Dog', channel: 'S.W.A.T', season: 8, episode: 20 };
  assert.equal(watchKey(s), 'en|series|Devil Dog|S.W.A.T|S8E20');
});

test('watchKey omits the episode tag when season/episode are missing', () => {
  const s = { language: 'fr', type: 'series', title: 'Episode 1', channel: '傳奇辦公室' };
  assert.equal(watchKey(s), 'fr|series|Episode 1|傳奇辦公室|');
});

test('watchKey covers youtube, podcast and reading, but not anki', () => {
  assert.ok(watchKey({ language: 'fr', type: 'youtube', title: 'x', channel: 'c' }));
  assert.ok(watchKey({ language: 'fr', type: 'podcast', title: 'x', channel: 'c' }));
  assert.ok(watchKey({ language: 'en', type: 'reading', title: 'x' }));
  assert.equal(watchKey({ language: 'fr', type: 'anki', title: 'Anki reviews' }), null);
});

test('watchKey is null for untitled content', () => {
  assert.equal(watchKey({ language: 'fr', type: 'youtube', title: '' }), null);
});

/* ── startsDone: which new items auto-complete ── */
test('auto-detected series episodes start todo in either language', () => {
  assert.equal(startsDone({ language: 'en', type: 'series', title: 'x', channel: 'c', source: 'auto' }), false);
  assert.equal(startsDone({ language: 'fr', type: 'series', title: 'x', channel: 'c', source: 'auto' }), false);
});

test('manually-entered youtube/podcast/series episodes start done — logging it after the fact means you watched it', () => {
  assert.equal(startsDone({ language: 'en', type: 'series', title: 'x', channel: 'c', source: 'manual' }), true);
  assert.equal(startsDone({ language: 'fr', type: 'series', title: 'x', channel: 'c', source: 'manual' }), true);
  assert.equal(startsDone({ language: 'en', type: 'podcast', title: 'x', channel: 'c', source: 'manual' }), true);
  assert.equal(startsDone({ language: 'fr', type: 'podcast', title: 'x', channel: 'c', source: 'manual' }), true);
  assert.equal(startsDone({ language: 'en', type: 'youtube', title: 'x', channel: 'c', source: 'manual' }), true);
  assert.equal(startsDone({ language: 'fr', type: 'youtube', title: 'x', channel: 'c', source: 'manual' }), true);
});

test('Shorts binges start done regardless of language', () => {
  assert.equal(startsDone({ language: 'fr', type: 'youtube', title: 'x', channel: 'Shorts' }), true);
  assert.equal(startsDone({ language: 'en', type: 'youtube', title: 'x', channel: 'Shorts' }), true);
});

test('ordinary auto-tracked youtube/podcast content (no source: manual) starts todo in either language', () => {
  assert.equal(startsDone({ language: 'en', type: 'youtube', title: 'x', channel: 'c' }), false);
  assert.equal(startsDone({ language: 'fr', type: 'podcast', title: 'x', channel: 'c' }), false);
});

/* ── manually-timed reading sessions (no auto-detection exists for
 * physical/e-reader reading, so every reading session is logged by hand) ── */
test('manual reading sessions get a checklist key and start todo, in either language', () => {
  const fr = { language: 'fr', type: 'reading', title: 'Le Petit Prince ch3', source: 'manual' };
  const en = { language: 'en', type: 'reading', title: 'The One Thing ch16', source: 'manual' };
  assert.equal(watchKey(fr), 'fr|reading|Le Petit Prince ch3||');
  assert.equal(watchKey(en), 'en|reading|The One Thing ch16||');
  assert.equal(startsDone(fr), false);
  assert.equal(startsDone(en), false);
});

/* ── Apple/Spotify podcast sessions (auto-tracked by the separate podcast
 * trackers, not the extension — source is 'apple'/'spotify'/'timer' rather
 * than 'auto', but that shouldn't change checklist behavior) ── */
test('Apple and Spotify podcast sessions get a checklist key and start todo, in either language', () => {
  const apple = { language: 'fr', type: 'podcast', title: 'Tony Parker et le proto Brad Pitt', channel: 'Small Talk - Konbini', source: 'apple' };
  const spotify = { language: 'en', type: 'podcast', title: 'Some Episode', channel: 'Some Show', source: 'spotify' };
  const timer = { language: 'en', type: 'podcast', title: 'Timed Episode', channel: 'Some Show', source: 'timer' };
  assert.equal(watchKey(apple), 'fr|podcast|Tony Parker et le proto Brad Pitt|Small Talk - Konbini|');
  assert.equal(watchKey(spotify), 'en|podcast|Some Episode|Some Show|');
  assert.equal(startsDone(apple), false);
  assert.equal(startsDone(spotify), false);
  assert.equal(startsDone(timer), false);
});

/* ── assignDefaultStates: fill gaps, never clobber existing state ── */
test('assignDefaultStates only fills missing keys and respects the startsDone rule', () => {
  const recent = [
    { language: 'fr', type: 'series', title: 'Ep1', channel: 'Show' },
    { language: 'en', type: 'series', title: 'Ep1', channel: 'Show' },
    { language: 'fr', type: 'youtube', title: 'Shorts binge', channel: 'Shorts' },
    { language: 'fr', type: 'youtube', title: 'Already done', channel: 'c' },
  ];
  const existing = { 'fr|youtube|Already done|c|': 'done' };
  const { state, changed } = assignDefaultStates(existing, recent);
  assert.equal(changed, true);
  assert.equal(state['fr|series|Ep1|Show|'], 'todo');
  assert.equal(state['en|series|Ep1|Show|'], 'todo');
  assert.equal(state['fr|youtube|Shorts binge|Shorts|'], 'done');
  assert.equal(state['fr|youtube|Already done|c|'], 'done'); // untouched
});

test('assignDefaultStates reports no change when nothing new appears', () => {
  const recent = [{ language: 'fr', type: 'youtube', title: 'x', channel: 'c' }];
  const existing = { 'fr|youtube|x|c|': 'done' };
  const { changed } = assignDefaultStates(existing, recent);
  assert.equal(changed, false);
});

test('assignDefaultStates does not mutate its inputs', () => {
  const existing = {};
  const recent = [{ language: 'fr', type: 'youtube', title: 'x', channel: 'c' }];
  assignDefaultStates(existing, recent);
  assert.deepEqual(existing, {}); // original object left alone
});

/* ── pruneDeadKeys: the regression that motivated this whole suite —
 * scrolling out of the display window must NOT delete a 'done' mark. ── */
test('pruneDeadKeys keeps a done mark for a session that still exists, even outside the window', () => {
  // "Gatsby" aged out of the recent list under a hard weekly reset, but the
  // underlying session row is still in allSessions — its mark must survive.
  const allSessions = [
    { date: '2026-07-14', language: 'fr', type: 'podcast', title: 'Gatsby le Magnifique', channel: 'Adapte-Moi Si Tu Peux' },
  ];
  const watchState = { 'fr|podcast|Gatsby le Magnifique|Adapte-Moi Si Tu Peux|': 'done' };
  const { state, changed } = pruneDeadKeys(watchState, allSessions);
  assert.equal(changed, false);
  assert.equal(state['fr|podcast|Gatsby le Magnifique|Adapte-Moi Si Tu Peux|'], 'done');
});

test('pruneDeadKeys drops a key once its session is genuinely gone', () => {
  const watchState = { 'fr|youtube|Deleted video|Some Channel|': 'todo' };
  const { state, changed } = pruneDeadKeys(watchState, []);
  assert.equal(changed, true);
  assert.equal('fr|youtube|Deleted video|Some Channel|' in state, false);
});

test('pruneDeadKeys does not mutate its inputs', () => {
  const watchState = { 'fr|youtube|Gone|c|': 'todo' };
  pruneDeadKeys(watchState, []);
  assert.deepEqual(watchState, { 'fr|youtube|Gone|c|': 'todo' });
});

/* ── goalStatusAll: both languages must individually hit their own goal ── */
test('goalStatusAll is not done if only one language met its own goal, even if the combined total clears the combined goal', () => {
  // 35 fr + 25 en = 60, equal to goals.fr+goals.en (30+30) — a naive "sum
  // >= combined goal" check would call this done; the real rule requires
  // each language to clear its own goal independently.
  const goals = { fr: 30, en: 30 };
  const status = goalStatusAll(goals, 35, 25);
  assert.equal(status.done, false);
  assert.equal(status.pct, 25 / 30);
});

test('goalStatusAll is done once both languages individually clear their own goal', () => {
  const status = goalStatusAll({ fr: 30, en: 30 }, 30, 45);
  assert.equal(status.done, true);
  assert.equal(status.pct, 1);
});

/* ── goalStatusSingle: plain single-language threshold ── */
test('goalStatusSingle done/pct thresholds', () => {
  assert.equal(goalStatusSingle(30, 29).done, false);
  assert.equal(goalStatusSingle(30, 30).done, true);
  assert.equal(goalStatusSingle(30, 15).pct, 0.5);
});

/* ── streakThreshold: the goal in effect on a given day ── */
test('streakThreshold follows the goal history: 30 before 2026-08-08, 60 after', () => {
  assert.equal(streakThreshold('2026-08-07'), 30);
  assert.equal(streakThreshold('2026-08-08'), 60); // raise takes effect that day
  assert.equal(streakThreshold('2026-08-20'), 60);
  assert.equal(streakThreshold('2026-01-01'), 30);
});

/* ── goalStreak: consecutive days meeting that day's goal. The counting/
   filter logic is tested with an injected fixed threshold; the per-day
   history is exercised separately below. ── */
const NOW = new Date('2026-08-20T10:00:00'); // logical today = 2026-08-20
const flat = (n) => () => n; // a thresholdFor that ignores the date

test('goalStreak counts consecutive days clearing the goal in one language', () => {
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(40) },
    { date: '2026-08-19', language: 'fr', seconds: min(35) },
    { date: '2026-08-18', language: 'fr', seconds: min(30) }, // exactly the goal counts
    { date: '2026-08-16', language: 'fr', seconds: min(90) }, // gap on the 17th
  ];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 3);
});

test('goalStreak: an in-progress today below the goal counts from yesterday, not a reset', () => {
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(20) }, // today, not there yet
    { date: '2026-08-19', language: 'fr', seconds: min(35) },
    { date: '2026-08-18', language: 'fr', seconds: min(40) },
  ];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 2);
});

test('goalStreak on the All view requires both languages to clear the goal', () => {
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(40) },
    { date: '2026-08-20', language: 'en', seconds: min(40) }, // both clear today
    { date: '2026-08-19', language: 'fr', seconds: min(40) },
    { date: '2026-08-19', language: 'en', seconds: min(20) }, // en short — breaks it
  ];
  assert.equal(goalStreak(sessions, 'all', NOW, flat(30)), 1);
});

test('goalStreak treats a day with no listening as a break, never counts empty days', () => {
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(40) },
    // nothing on 2026-08-19
    { date: '2026-08-18', language: 'fr', seconds: min(40) },
  ];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 1);
});

test('goalStreak judges each day against the goal in effect that day (real history)', () => {
  // A 40-min day AFTER the raise fails the 60 goal and breaks the run...
  const after = [
    { date: '2026-08-09', language: 'en', seconds: min(70) }, // needs 60 -> met
    { date: '2026-08-08', language: 'en', seconds: min(40) }, // needs 60 -> NOT met
  ];
  assert.equal(goalStreak(after, 'en', new Date('2026-08-09T10:00:00')), 1);
  // ...but the same 40-min day BEFORE the raise clears the old 30 goal.
  const before = [
    { date: '2026-08-07', language: 'en', seconds: min(40) }, // needs 30 -> met
    { date: '2026-08-06', language: 'en', seconds: min(40) }, // needs 30 -> met
  ];
  assert.equal(goalStreak(before, 'en', new Date('2026-08-07T10:00:00')), 2);
});

/* ── minutesByDate / computeStats: shared by the dashboard and the
   popup, which used to compute this by hand independently ── */
test('minutesByDate sums seconds per date across languages and types', () => {
  const sessions = [
    { date: '2026-07-20', seconds: 60 },
    { date: '2026-07-20', seconds: 120 },
    { date: '2026-07-21', seconds: 30 },
  ];
  assert.deepEqual(minutesByDate(sessions), { '2026-07-20': 3, '2026-07-21': 0.5 });
});

test('computeStats sums today/week/month against a pinned clock', () => {
  // Monday 2026-07-20 is the week start; July is the month.
  const now = new Date('2026-07-22T10:00:00');
  const sessions = [
    { date: '2026-07-22', seconds: 600 },  // today, 10 min
    { date: '2026-07-20', seconds: 1200 }, // this week (Monday), 20 min
    { date: '2026-06-30', seconds: 6000 }, // last month, excluded
  ];
  const stats = computeStats(sessions, now);
  assert.equal(stats.today, 10);
  assert.equal(stats.week, 30);
  assert.equal(stats.month, 30);
  assert.equal(stats.total, 30 + 100); // 6000s = 100min, still counts toward total
});

test('computeStats streak counts consecutive logical days ending today', () => {
  const now = new Date('2026-07-22T10:00:00');
  const sessions = [
    { date: '2026-07-22', seconds: 60 },
    { date: '2026-07-21', seconds: 60 },
    { date: '2026-07-20', seconds: 60 },
    { date: '2026-07-18', seconds: 60 }, // gap on the 19th breaks the streak
  ];
  assert.equal(computeStats(sessions, now).streak, 3);
});

test('computeStats streak is 0 with no session today or yesterday', () => {
  const now = new Date('2026-07-22T10:00:00');
  const sessions = [{ date: '2026-07-10', seconds: 60 }];
  assert.equal(computeStats(sessions, now).streak, 0);
});

/* ── sessionLang / normType basics ── */
test('sessionLang defaults anything that is not en to fr', () => {
  assert.equal(sessionLang({ language: 'en' }), 'en');
  assert.equal(sessionLang({ language: 'fr' }), 'fr');
  assert.equal(sessionLang({ language: null }), 'fr');
  assert.equal(sessionLang({}), 'fr');
});

test('normType falls back to youtube for unrecognized types', () => {
  assert.equal(normType({ type: 'series' }), 'series');
  assert.equal(normType({ type: 'bogus' }), 'youtube');
  assert.equal(normType({}), 'youtube');
});

test('sessionWatchKeys collapses a video\'s split sessions into one key', () => {
  const rows = [
    { type: 'youtube', title: 'Point Culture', channel: 'LinksTheSun', language: 'fr' },
    { type: 'youtube', title: 'Point Culture', channel: 'LinksTheSun', language: 'fr' },
  ];
  assert.deepEqual(sessionWatchKeys(rows), ['fr|youtube|Point Culture|LinksTheSun|']);
});

test('sessionWatchKeys keeps genuinely different keys apart and drops keyless rows', () => {
  const rows = [
    { type: 'youtube', title: 'Same', channel: 'C', language: 'fr' },
    { type: 'youtube', title: 'Same', channel: 'C', language: 'en' }, // other language
    { type: 'anki', title: 'Anki reviews', language: 'fr' },          // no checkbox
    { type: 'youtube', title: '', channel: 'C', language: 'fr' },     // untitled
  ];
  assert.deepEqual(sessionWatchKeys(rows).sort(), ['en|youtube|Same|C|', 'fr|youtube|Same|C|']);
});

test('sessionWatchKeys handles no rows at all', () => {
  assert.deepEqual(sessionWatchKeys([]), []);
  assert.deepEqual(sessionWatchKeys(undefined), []);
});

/* ── Linking a curated page to what was watched ─────────── */

test('videoIdFromUrl reads watch, share, embed and shorts links', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=uyLbScMzyi8'), 'uyLbScMzyi8');
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?t=30&v=uyLbScMzyi8'), 'uyLbScMzyi8');
  assert.equal(videoIdFromUrl('https://youtu.be/ksw7lp_rI7Y'), 'ksw7lp_rI7Y');
  assert.equal(videoIdFromUrl('https://www.youtube.com/embed/c6axar1j8GM'), 'c6axar1j8GM');
  assert.equal(videoIdFromUrl('https://www.youtube.com/shorts/eeFycGv7kRk'), 'eeFycGv7kRk');
});

test('videoIdFromUrl finds nothing in a search or podcast link', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/results?search_query=lyon'), '');
  assert.equal(videoIdFromUrl('https://podcasts.apple.com/fr/podcast/bouffons/id1324604234'), '');
  assert.equal(videoIdFromUrl(''), '');
  assert.equal(videoIdFromUrl(undefined), '');
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v='), '');
});

test('normShow sees past case, accents, curly apostrophes and spacing', () => {
  assert.equal(normShow('  On va DÉGUSTER '), 'on va deguster');
  assert.equal(normShow('L\u2019After Foot'), normShow("L'after foot"));
  assert.equal(normShow('Les   Baladeurs'), 'les baladeurs');
  assert.equal(normShow(''), '');
});

test('contentLinks takes a video from the url and a show from the field', () => {
  assert.deepEqual(
    contentLinks({ url: 'https://www.youtube.com/watch?v=uyLbScMzyi8' }),
    { videoIds: ['uyLbScMzyi8'], shows: [] },
  );
  assert.deepEqual(
    contentLinks({ url: 'https://podcasts.apple.com/x', show: 'On va déguster' }),
    { videoIds: [], shows: ['on va deguster'] },
  );
  assert.deepEqual(contentLinks({ url: yt() }), { videoIds: [], shows: [] });
});

const yt = () => 'https://www.youtube.com/results?search_query=lyon';

test('doneItemIds ticks an item whose video À regarder has ticked', () => {
  const items = [{ id: 'lyon-eb', url: 'https://www.youtube.com/watch?v=V1' }];
  const done = doneItemIds(items, [], { V1: { done: true } }, {});
  assert.deepEqual([...done], ['lyon-eb']);
});

test('doneItemIds ticks an item whose session the dashboard has ticked', () => {
  const items = [{ id: 'lyon-eb', url: 'https://www.youtube.com/watch?v=V1' }];
  const rows = [{ video_id: 'V1', type: 'youtube', title: 'Lyon', channel: 'France 5', language: 'fr' }];
  const watchTodo = { 'fr|youtube|Lyon|France 5|': 'done' };
  assert.deepEqual([...doneItemIds(items, rows, {}, watchTodo)], ['lyon-eb']);
});

test('doneItemIds leaves an item whose session is still todo', () => {
  const items = [{ id: 'lyon-eb', url: 'https://www.youtube.com/watch?v=V1' }];
  const rows = [{ video_id: 'V1', type: 'youtube', title: 'Lyon', channel: 'France 5', language: 'fr' }];
  assert.deepEqual([...doneItemIds(items, rows, {}, { 'fr|youtube|Lyon|France 5|': 'todo' })], []);
});

test('doneItemIds matches a podcast by show, one finished episode being enough', () => {
  const items = [{ id: 'gen-ovd', url: 'https://podcasts.apple.com/x', show: 'On va déguster' }];
  const rows = [
    { type: 'podcast', title: 'Ép. 1', channel: 'On va Déguster', language: 'fr', video_id: '' },
    { type: 'podcast', title: 'Ép. 2', channel: 'On va Déguster', language: 'fr', video_id: '' },
  ];
  const watchTodo = { 'fr|podcast|Ép. 1|On va Déguster|': 'todo', 'fr|podcast|Ép. 2|On va Déguster|': 'done' };
  assert.deepEqual([...doneItemIds(items, rows, {}, watchTodo)], ['gen-ovd']);
});

test('doneItemIds ignores a session for a different show', () => {
  const items = [{ id: 'gen-ovd', url: 'https://podcasts.apple.com/x', show: 'On va déguster' }];
  const rows = [{ type: 'podcast', title: 'E', channel: 'Bouffons', language: 'fr', video_id: '' }];
  assert.deepEqual([...doneItemIds(items, rows, {}, { 'fr|podcast|E|Bouffons|': 'done' })], []);
});

test('doneItemIds says nothing about an item with no video and no show', () => {
  const items = [{ id: 'lyon-bouchons', url: yt() }];
  const rows = [{ video_id: 'V1', type: 'youtube', title: 'x', channel: 'c', language: 'fr' }];
  assert.deepEqual([...doneItemIds(items, rows, { V1: { done: true } }, {})], []);
});

test('doneItemIds copes with empty everything', () => {
  assert.deepEqual([...doneItemIds([], [], {}, {})], []);
  assert.deepEqual([...doneItemIds(undefined, undefined, undefined, undefined)], []);
});
