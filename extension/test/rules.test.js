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
  withDoneAt, compareWatchlist, doneAtLabel,
  assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
  streakThreshold, goalStreak,
  MONTHLY_BREAK_ALLOWANCE,
  legacyWatchKey,
  migrateWatchKeys,

  vacationDay,
  VACATION_SCREEN_LIMIT_MIN,
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
    { date: '2026-08-17', language: 'fr', seconds: min(30) },
  ];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 4);
});

test('goalStreak: a gap holds the run but is not itself counted', () => {
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(40) },
    { date: '2026-08-19', language: 'fr', seconds: min(35) },
    { date: '2026-08-18', language: 'fr', seconds: min(30) },
    // nothing on the 17th — forgiven, so the 16th still joins the run...
    { date: '2026-08-16', language: 'fr', seconds: min(90) },
  ];
  // ...but the empty day adds nothing: four days did the work, not five.
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 4);
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

test('goalStreak never counts an empty day, even when it forgives one', () => {
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(40) },
    // nothing on 2026-08-19 — inside the monthly allowance
    { date: '2026-08-18', language: 'fr', seconds: min(40) },
  ];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 2);
  // With no allowance at all the gap is fatal, as it used to be.
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30), 0), 1);
});

/* ── The monthly break allowance: two missed days a month are forgiven, hold
   the chain, and never count toward the number. ── */

// A day that clears a flat 30-minute goal.
const did = (date) => ({ date, language: 'fr', seconds: min(40) });

test('two missed days in a month are forgiven, a third ends the run', () => {
  // 20th back to 14th, with the 18th and 16th missed — two breaks, both inside
  // the allowance, so the run reaches the 14th.
  const twoGaps = ['2026-08-20', '2026-08-19', '2026-08-17', '2026-08-15', '2026-08-14'].map(did);
  assert.equal(goalStreak(twoGaps, 'fr', NOW, flat(30)), 5);

  // Move that last day back to the 13th and the 14th becomes a third break.
  // The allowance is spent, so the run stops there: 20, 19, 17, 15 — four days,
  // and the 13th never joins however much work it holds.
  const threeGaps = ['2026-08-20', '2026-08-19', '2026-08-17', '2026-08-15', '2026-08-13'].map(did);
  assert.equal(goalStreak(threeGaps, 'fr', NOW, flat(30)), 4);
});

test('the allowance is per calendar month, so a new month restores it', () => {
  // Two breaks in August (the 18th and 16th) exhaust that month. Crossing into
  // July the budget is fresh, so the gap on 31 July is forgiven too.
  const sessions = ['2026-08-20', '2026-08-19', '2026-08-17', '2026-08-15',
                    '2026-08-02', '2026-08-01', '2026-07-30'].map(did);
  // Aug 14..03 are all missing, which blows the August allowance long before
  // July is reached — the run stops inside August.
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 4);

  // With the August days contiguous, the month boundary is actually reached.
  const upToBoundary = [];
  for (let d = 20; d >= 1; d--) upToBoundary.push(did(`2026-08-${String(d).padStart(2, '0')}`));
  upToBoundary.push(did('2026-07-30')); // 31 July missing — forgiven by July's budget
  assert.equal(goalStreak(upToBoundary, 'fr', NOW, flat(30)), 21);
});

test('a missed day is forgiven only once, not re-forgiven on every step back', () => {
  // Two consecutive empty days (18th, 17th) use both of August's breaks.
  const sessions = ['2026-08-20', '2026-08-19', '2026-08-16'].map(did);
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 3);
  // A third consecutive empty day has nothing left to spend.
  const deeper = ['2026-08-20', '2026-08-19', '2026-08-15'].map(did);
  assert.equal(goalStreak(deeper, 'fr', NOW, flat(30)), 2);
});

test('an in-progress today is skipped, never charged to the allowance', () => {
  // Today is short, and the two days before it are empty. If today had spent a
  // break there would be only one left and the run would stop at the 19th.
  const sessions = [
    { date: '2026-08-20', language: 'fr', seconds: min(5) }, // today, not there yet
    did('2026-08-17'),
  ];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 1);
});

test('the walk does not forgive its way past the first tracked day', () => {
  // One lone day at the start of tracking: nothing before it is a "break",
  // it is simply before the beginning.
  const sessions = [did('2026-08-20')];
  assert.equal(goalStreak(sessions, 'fr', NOW, flat(30)), 1);
});

test('a travelling day is earned and counts; a forgiven day is not and does not', () => {
  const sessions = [...travelling('2026-10-11'), ...travelling('2026-10-10')];
  // Both days travelled: both counted.
  assert.equal(goalStreak(sessions, 'all', new Date('2026-10-11T12:00:00')), 2);
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
  assert.deepEqual([...doneItemIds(items, rows, {}, { 'fr|youtube|v:V1': 'done' })], ['lyon-eb']);
});

test('a tick stored under the old title key still counts, before any migration', () => {
  // Every surface reads this state, and only the dashboard rewrites it — so
  // until it next loads, the trip list must not re-offer a finished video.
  const items = [{ id: 'lyon-eb', url: 'https://www.youtube.com/watch?v=V1' }];
  const rows = [{ video_id: 'V1', type: 'youtube', title: 'Lyon', channel: 'France 5', language: 'fr' }];
  assert.deepEqual([...doneItemIds(items, rows, {}, { 'fr|youtube|Lyon|France 5|': 'done' })], ['lyon-eb']);
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

/* ── À regarder: finishing a video ──────────────────────── */

test('withDoneAt stamps the time on the way in and clears it on the way out', () => {
  const entry = { videoId: 'V1', title: 't', done: false };
  const done = withDoneAt(entry, true, 1000);
  assert.equal(done.done, true);
  assert.equal(done.doneAt, 1000);
  assert.equal(done.title, 't', 'the rest of the entry survives');
  const undone = withDoneAt(done, false);
  assert.equal(undone.done, false);
  assert.ok(!('doneAt' in undone), 'an unticked video has no finished-at time');
});

test('withDoneAt does not mutate the entry it is given', () => {
  const entry = { videoId: 'V1', done: false };
  withDoneAt(entry, true, 1000);
  assert.deepEqual(entry, { videoId: 'V1', done: false });
});

test('compareWatchlist keeps what is still to watch on top', () => {
  const order = [
    { videoId: 'done', done: true, doneAt: 9000, addedAt: 1 },
    { videoId: 'todo', done: false, addedAt: 1 },
  ].sort(compareWatchlist).map((i) => i.videoId);
  assert.deepEqual(order, ['todo', 'done']);
});

test('compareWatchlist puts the most recently finished first', () => {
  const order = [
    { videoId: 'old', done: true, doneAt: 1000 },
    { videoId: 'newest', done: true, doneAt: 3000 },
    { videoId: 'middle', done: true, doneAt: 2000 },
  ].sort(compareWatchlist).map((i) => i.videoId);
  assert.deepEqual(order, ['newest', 'middle', 'old']);
});

test('compareWatchlist sorts unwatched by newest added', () => {
  const order = [
    { videoId: 'older', done: false, addedAt: 1000 },
    { videoId: 'newer', done: false, addedAt: 2000 },
  ].sort(compareWatchlist).map((i) => i.videoId);
  assert.deepEqual(order, ['newer', 'older']);
});

test('compareWatchlist leaves videos finished before doneAt existed at the end', () => {
  // No stamp must not read as "finished at the epoch and therefore oldest" in
  // one direction or "just now" in the other — they go last, by addedAt.
  const order = [
    { videoId: 'unstamped-old', done: true, addedAt: 1000 },
    { videoId: 'stamped', done: true, doneAt: 5000, addedAt: 1 },
    { videoId: 'unstamped-new', done: true, addedAt: 2000 },
  ].sort(compareWatchlist).map((i) => i.videoId);
  assert.deepEqual(order, ['stamped', 'unstamped-new', 'unstamped-old']);
});

test('doneAtLabel says today, yesterday, or the date', () => {
  const now = new Date('2026-09-05T20:00:00');
  const at = (iso) => new Date(iso).getTime();
  assert.equal(doneAtLabel(at('2026-09-05T10:00:00'), now), "aujourd'hui");
  assert.equal(doneAtLabel(at('2026-09-04T22:00:00'), now), 'hier');
  assert.match(doneAtLabel(at('2026-08-21T15:00:00'), now), /21/);
});

test('doneAtLabel buckets on the 4am day, so 2am is still last night', () => {
  const now = new Date('2026-09-05T20:00:00');
  assert.equal(doneAtLabel(new Date('2026-09-05T02:00:00').getTime(), now), 'hier');
});

test('doneAtLabel dates a late-night finish by the same day it called "hier"', () => {
  // Finished 01:30 on the 28th — the evening of the 27th by the tracker's day.
  // It reads "hier" while the reader is still on the 28th, so once it falls
  // back to a date that date must be the 27th, not the 28th.
  const finished = new Date('2026-08-28T01:30:00').getTime();
  assert.equal(doneAtLabel(finished, new Date('2026-08-28T10:00:00')), 'hier');
  assert.match(doneAtLabel(finished, new Date('2026-08-30T10:00:00')), /27/);
});

test('doneAtLabel dates a daytime finish by its own date', () => {
  const finished = new Date('2026-08-28T15:00:00').getTime();
  assert.match(doneAtLabel(finished, new Date('2026-08-30T10:00:00')), /28/);
});

test('doneAtLabel says nothing without a stamp', () => {
  assert.equal(doneAtLabel(0), '');
  assert.equal(doneAtLabel(undefined), '');
});

/* ── Identity by video id, and the migration onto it ── */
// Finary renamed "Le seul cours d'économie dont vous aurez besoin (99 % ne
// l'ont jamais eu)" mid-way through it being watched, and the same 28 minutes
// became two dashboard entries with two checkboxes.
const ECON_OLD = "Le seul cours d'économie dont vous aurez besoin (99 % ne l'ont jamais eu)";
const ECON_NEW = "Le seul cours d'économie dont vous aurez besoin";
const econ = (title, date) => ({
  type: 'youtube', language: 'fr', channel: 'Finary', video_id: 'dAenp-6u9xU', title, date,
});

test('a renamed video keeps one key, because the id did not change', () => {
  assert.equal(watchKey(econ(ECON_OLD, '2026-08-25')), watchKey(econ(ECON_NEW, '2026-09-27')));
  assert.match(watchKey(econ(ECON_NEW, '2026-09-27')), /\|v:dAenp-6u9xU$/);
});

test('two genuinely different videos still differ, and language still splits them', () => {
  assert.notEqual(watchKey(econ(ECON_NEW, '2026-09-27')),
                  watchKey({ ...econ(ECON_NEW, '2026-09-27'), video_id: 'other123456' }));
  assert.notEqual(watchKey(econ(ECON_NEW, '2026-09-27')),
                  watchKey({ ...econ(ECON_NEW, '2026-09-27'), language: 'en' }));
});

test('content with no id keeps the title key — podcasts, books, episodes', () => {
  const pod = { type: 'podcast', language: 'fr', channel: 'InnerFrench', title: 'E42', video_id: '' };
  assert.equal(watchKey(pod), legacyWatchKey(pod));
  const ep = { type: 'series', language: 'fr', channel: 'Lupin', title: 'Chapitre 3', season: 1, episode: 3 };
  assert.equal(watchKey(ep), legacyWatchKey(ep));
  assert.match(watchKey(ep), /S1E3$/);
  assert.equal(watchKey({ type: 'youtube', title: '', video_id: '' }), null);
  assert.equal(watchKey({ type: 'anki', title: 'Anki reviews', video_id: '' }), null);
});

test('migration moves a stored tick from the title key onto the id key', () => {
  const sessions = [econ(ECON_OLD, '2026-08-25'), econ(ECON_NEW, '2026-09-27')];
  const before = { [legacyWatchKey(econ(ECON_OLD, '2026-08-25'))]: 'done' };
  const { state, changed } = migrateWatchKeys(before, sessions);
  assert.equal(changed, true);
  assert.deepEqual(state, { [watchKey(econ(ECON_NEW, '2026-09-27'))]: 'done' });
});

test('a rename that left two stored keys collapses to one, and done wins', () => {
  const sessions = [econ(ECON_OLD, '2026-08-25'), econ(ECON_NEW, '2026-09-27')];
  const both = {
    [legacyWatchKey(econ(ECON_OLD, '2026-08-25'))]: 'done',
    [legacyWatchKey(econ(ECON_NEW, '2026-09-27'))]: 'todo',
  };
  const { state } = migrateWatchKeys(both, sessions);
  assert.deepEqual(state, { [watchKey(econ(ECON_NEW, '2026-09-27'))]: 'done' });
});

test('migration leaves keys it does not recognise alone, and is a no-op once done', () => {
  const sessions = [econ(ECON_NEW, '2026-09-27')];
  const already = { [watchKey(econ(ECON_NEW, '2026-09-27'))]: 'todo', 'fr|podcast|E42|InnerFrench|': 'done' };
  const { state, changed } = migrateWatchKeys(already, sessions);
  assert.equal(changed, false);
  assert.deepEqual(state, already);
});

test('a migrated tick survives the prune that follows it', () => {
  // The regression this guards: pruneDeadKeys sees a title-keyed state as
  // entirely dead and throws away every tick in it.
  const sessions = [econ(ECON_OLD, '2026-08-25'), econ(ECON_NEW, '2026-09-27')];
  const stored = { [legacyWatchKey(econ(ECON_OLD, '2026-08-25'))]: 'done' };
  const migrated = migrateWatchKeys(stored, sessions);
  const pruned = pruneDeadKeys(migrated.state, sessions);
  assert.deepEqual(pruned.state, { [watchKey(econ(ECON_NEW, '2026-09-27'))]: 'done' });
  assert.equal(pruneDeadKeys(stored, sessions).state[Object.keys(stored)[0]], undefined);
});

test('grouping puts a renamed video back into a single row', () => {
  const rows = [econ(ECON_OLD, '2026-08-25'), econ(ECON_NEW, '2026-09-27')].map((r, i) => ({ ...r, id: `r${i}`, seconds: 300 }));
  assert.equal(sessionWatchKeys(rows).length, 1);
});

test('pruning is safe to run on a view that only knows some of the keys', () => {
  // It is still destructive by nature — this pins what it does so the caller
  // can be judged, since the caller is what went wrong: pruning on every load
  // let a dashboard copy on older code delete 204 ticks it did not recognise.
  const mine = { type: 'youtube', language: 'fr', title: 'A', channel: 'C', video_id: 'V1' };
  const state = { [watchKey(mine)]: 'done', 'some|other|clients|key|': 'done' };
  assert.deepEqual(pruneDeadKeys(state, [mine]).state, { [watchKey(mine)]: 'done' });
  // ...and with no sessions in view at all, it empties the lot. Which is why
  // it may only run where a deletion just happened, never on a load.
  assert.deepEqual(pruneDeadKeys(state, []).state, {});
});

/* ── Vacation days ── */
// YouTube and series are the sit-down habits. A day with neither is a day
// travelling, and it holds the streak on different terms: reading in both
// languages, and the French deck reviewed.
const day = (date, type, language, minutes) =>
  ({ date, type, language, seconds: minutes * 60 });

const travelling = (date) => [
  day(date, 'reading', 'fr', 20),
  day(date, 'reading', 'en', 15),
  day(date, 'anki', 'fr', 10),
];

test('a travelling day is one with no real amount of youtube or series', () => {
  assert.equal(vacationDay(travelling('2026-10-09')), true);
  assert.equal(vacationDay([...travelling('2026-10-09'), day('2026-10-09', 'youtube', 'fr', 40)]), false);
  assert.equal(vacationDay([...travelling('2026-10-09'), day('2026-10-09', 'series', 'en', 40)]), false);
});

test('a clip or two does not cost the day', () => {
  // 3m40s of tennis highlights on 11 Oct 2026 disqualified a day of reading
  // and Anki, and a 72-day streak with it.
  const d = '2026-10-11';
  const withClip = (mins) => vacationDay([...travelling(d), day(d, 'youtube', 'en', mins)]);
  assert.equal(withClip(4), true);
  assert.equal(withClip(VACATION_SCREEN_LIMIT_MIN), true, 'the limit itself is still a travelling day');
  assert.equal(withClip(VACATION_SCREEN_LIMIT_MIN + 1), false);
});

test('the allowance is for the whole day, not for each sitting', () => {
  const d = '2026-10-11';
  const rows = [...travelling(d), day(d, 'youtube', 'en', 8), day(d, 'series', 'fr', 9)];
  assert.equal(vacationDay(rows), false, '17 minutes between them is a desk session');
});

test('podcasts never eat into the allowance', () => {
  const d = '2026-10-11';
  assert.equal(vacationDay([...travelling(d), day(d, 'podcast', 'fr', 90)]), true);
});

test('podcasts travel too, so they do not end a vacation day', () => {
  assert.equal(vacationDay([...travelling('2026-10-09'), day('2026-10-09', 'podcast', 'fr', 40)]), true);
});

test('a travelling day still has to do the work: both readings and the French deck', () => {
  const d = '2026-10-08';
  assert.equal(vacationDay([day(d, 'reading', 'fr', 30), day(d, 'reading', 'en', 30)]), false, 'no anki');
  assert.equal(vacationDay([day(d, 'reading', 'fr', 30), day(d, 'anki', 'fr', 10)]), false, 'no English reading');
  assert.equal(vacationDay([day(d, 'reading', 'en', 30), day(d, 'anki', 'fr', 10)]), false, 'no French reading');
  assert.equal(vacationDay([day(d, 'reading', 'fr', 30), day(d, 'reading', 'en', 30), day(d, 'anki', 'en', 10)]),
    false, 'the deck has to be the French one');
  assert.equal(vacationDay([]), false);
});

test('a travelling day keeps the streak on minutes it would otherwise fail', () => {
  // Nowhere near the 60-minute goal in either language, and it counts anyway.
  const sessions = [
    ...travelling('2026-10-11'), ...travelling('2026-10-10'), ...travelling('2026-10-09'),
  ];
  const now = new Date('2026-10-11T12:00:00');
  assert.equal(goalStreak(sessions, 'all', now), 3);
  assert.equal(goalStreak(sessions, 'fr', now), 3);
  assert.equal(goalStreak(sessions, 'en', now), 3);
});

test('a day at the desk is still judged on minutes, vacation rule or not', () => {
  // Reading in both and the deck done, but a real YouTube session makes it an
  // ordinary day — and 20 minutes does not clear the goal.
  const d = '2026-10-11';
  const sessions = [...travelling(d), day(d, 'youtube', 'fr', 45)];
  assert.equal(goalStreak(sessions, 'all', new Date('2026-10-11T12:00:00')), 0);
});

test('a travelling day bridges two ordinary days instead of breaking the run', () => {
  const sessions = [
    day('2026-10-11', 'youtube', 'fr', 70), day('2026-10-11', 'youtube', 'en', 70),
    ...travelling('2026-10-10'),
    day('2026-10-09', 'youtube', 'fr', 70), day('2026-10-09', 'youtube', 'en', 70),
  ];
  assert.equal(goalStreak(sessions, 'all', new Date('2026-10-11T12:00:00')), 3);
});

test('an empty day is forgiven, but still never counts — vacation is not absence', () => {
  const sessions = [...travelling('2026-10-11'), ...travelling('2026-10-09')];
  // The 10th is empty: forgiven, so the 9th still joins the run. Two days
  // travelled, two days counted.
  assert.equal(goalStreak(sessions, 'all', new Date('2026-10-11T12:00:00')), 2);
  // A travelling day is earned, an empty one is only tolerated: with the
  // allowance spent, the distinction is the old one again.
  assert.equal(goalStreak(sessions, 'all', new Date('2026-10-11T12:00:00'),
                          undefined, 0), 1);
});

test('the goal ring agrees with the streak on a travelling day', () => {
  // Nowhere near 60 minutes in either language, and the ring reads full —
  // the same day the streak counts, reported as travel rather than as a
  // goal that was hit.
  const rows = travelling('2026-10-11');
  const all = goalStatusAll({ fr: 60, en: 60 }, 20, 15, rows);
  assert.equal(all.done, true);
  assert.equal(all.pct, 1);
  assert.equal(all.vacation, true);

  const single = goalStatusSingle(60, 20, rows);
  assert.deepEqual(single, { done: true, pct: 1, vacation: true });
});

test('a day at the desk is still measured in minutes', () => {
  const rows = [...travelling('2026-10-11'), day('2026-10-11', 'youtube', 'fr', 45)];
  const all = goalStatusAll({ fr: 60, en: 60 }, 25, 15, rows);
  assert.equal(all.done, false);
  assert.equal(all.vacation, false);
  assert.ok(all.pct < 1);
  assert.equal(goalStatusSingle(60, 25, rows).done, false);
});

test('a goal met on minutes is not reported as travel', () => {
  // Both can be true at once; the day should read as the goal being hit.
  const rows = travelling('2026-10-11');
  assert.equal(goalStatusAll({ fr: 60, en: 60 }, 70, 70, rows).vacation, true);
  assert.equal(goalStatusAll({ fr: 60, en: 60 }, 70, 70, []).vacation, false);
  assert.equal(goalStatusAll({ fr: 60, en: 60 }, 70, 70, []).done, true);
});

test('the goal status still works when nobody passes today\'s rows', () => {
  // Older callers, and the popup before its query included `type`.
  assert.equal(goalStatusSingle(60, 70).done, true);
  assert.equal(goalStatusSingle(60, 30).done, false);
  assert.equal(goalStatusAll({ fr: 60, en: 60 }, 70, 70).done, true);
  assert.equal(goalStatusSingle(60, 70).vacation, false);
});
