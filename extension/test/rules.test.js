// Sanity suite for extension/rules.js — the pure decision logic behind the
// dashboard's window reset, watch-todo checklist, and daily goal math. Run
// with `node --test extension/test` (see .githooks/pre-commit, pre-push).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dateKey, logicalNow, todayKey, startOfWeek,
  sessionLang, normType, watchKey, startsDone,
  assignDefaultStates, pruneDeadKeys, goalStatusAll, goalStatusSingle,
} = require('../rules.js');

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
test('English series episodes start done', () => {
  assert.equal(startsDone({ language: 'en', type: 'series', title: 'x', channel: 'c' }), true);
});

test('French series episodes start todo, not done', () => {
  assert.equal(startsDone({ language: 'fr', type: 'series', title: 'x', channel: 'c' }), false);
});

test('Shorts binges start done regardless of language', () => {
  assert.equal(startsDone({ language: 'fr', type: 'youtube', title: 'x', channel: 'Shorts' }), true);
  assert.equal(startsDone({ language: 'en', type: 'youtube', title: 'x', channel: 'Shorts' }), true);
});

test('ordinary youtube/podcast/reading content starts todo in either language', () => {
  assert.equal(startsDone({ language: 'en', type: 'youtube', title: 'x', channel: 'c' }), false);
  assert.equal(startsDone({ language: 'fr', type: 'podcast', title: 'x', channel: 'c' }), false);
});

/* ── assignDefaultStates: fill gaps, never clobber existing state ── */
test('assignDefaultStates only fills missing keys and respects the startsDone rule', () => {
  const recent = [
    { language: 'fr', type: 'series', title: 'Ep1', channel: 'Show' },
    { language: 'en', type: 'series', title: 'Ep1', channel: 'Show' },
    { language: 'fr', type: 'youtube', title: 'Already done', channel: 'c' },
  ];
  const existing = { 'fr|youtube|Already done|c|': 'done' };
  const { state, changed } = assignDefaultStates(existing, recent);
  assert.equal(changed, true);
  assert.equal(state['fr|series|Ep1|Show|'], 'todo');
  assert.equal(state['en|series|Ep1|Show|'], 'done');
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
