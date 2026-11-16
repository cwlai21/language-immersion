// Sanity suite for extension/session-rules.js — the pure YouTube watch-session
// transition. Run with `node --test extension/test` (see the git hooks).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyHeartbeat, serialize, findDuplicateSessions } = require('../session-rules.js');

const NOW = 1_000_000;
const DATE = '2026-08-20';
const track = (lang) => ({ lang, reason: 'detected' });
const vid = (videoId, extra = {}) => ({ videoId, title: 't', channel: 'c', channelId: 'ci', ...extra });

/* ── the regression this guards: a paused second tab must not chop the
   active session into a row per minute ── */
test('a paused heartbeat for a DIFFERENT video is ignored, leaving the active session intact', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en', lastBeat: 500 };
  const step = applyHeartbeat(
    active,
    { video: vid('B'), seconds: 0, playing: false, decision: track('en') },
    NOW, DATE,
  );
  assert.deepEqual(step, { ignored: true });
});

test('a PLAYING different video hands over: finalize the old session, start the new one', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en' };
  const step = applyHeartbeat(
    active,
    { video: vid('B', { title: 'New', channel: 'Chan' }), seconds: 5, playing: true, decision: track('fr') },
    NOW, DATE,
  );
  assert.equal(step.finalized, active);          // old session handed to the caller to finalize
  assert.equal(step.session.videoId, 'B');
  assert.equal(step.session.title, 'New');
  assert.equal(step.session.seconds, 5);
  assert.equal(step.session.lang, 'fr');
  assert.equal(step.session.date, DATE);
});

test('the same video accumulates seconds and refreshes lastBeat, nothing finalized', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en', lastBeat: 500 };
  const step = applyHeartbeat(
    active,
    { video: vid('A'), seconds: 15, playing: true, decision: track('en') },
    NOW, DATE,
  );
  assert.equal(step.finalized, null);
  assert.equal(step.session.seconds, 135);
  assert.equal(step.session.lastBeat, NOW);
});

/* ── the regression this guards: a paused tab flushes every 15s with
   seconds: 0, and treating those as activity kept lastBeat fresh forever, so
   the idle finalize never fired and the session never reached the dashboard ── */
test('a paused heartbeat for the SAME video does not refresh lastBeat, so the session can go idle', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en', lastBeat: 500 };
  const step = applyHeartbeat(
    active,
    { video: vid('A'), seconds: 0, playing: false, decision: track('en') },
    NOW, DATE,
  );
  assert.equal(step.finalized, null); // still the current session, just stale
  assert.equal(step.session.seconds, 120);
  assert.equal(step.session.lastBeat, 500);
});

test('a paused heartbeat still self-corrects the language (ASR re-probe)', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en', reason: 'title', lastBeat: 500 };
  const step = applyHeartbeat(
    active,
    { video: vid('A'), seconds: 0, playing: false, decision: { lang: 'fr', reason: 'asr' } },
    NOW, DATE,
  );
  assert.equal(step.session.lang, 'fr');
  assert.equal(step.session.reason, 'asr');
});

test('with no current session, a tracked heartbeat starts a fresh one', () => {
  const step = applyHeartbeat(
    null,
    { video: vid('A'), seconds: 5, playing: true, decision: track('en') },
    NOW, DATE,
  );
  assert.equal(step.finalized, null);
  assert.equal(step.session.videoId, 'A');
  assert.equal(step.session.seconds, 5);
  assert.equal(step.session.startedAt, NOW);
});

test('a null decision (untracked) on the same video leaves the session unchanged', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en' };
  const step = applyHeartbeat(
    active,
    { video: vid('A'), seconds: 15, playing: true, decision: null },
    NOW, DATE,
  );
  assert.equal(step.finalized, null);
  assert.equal(step.session, active); // untouched
});

test('applyHeartbeat does not mutate the input session', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en', lastBeat: 500 };
  applyHeartbeat(active, { video: vid('A'), seconds: 15, playing: true, decision: track('en') }, NOW, DATE);
  assert.equal(active.seconds, 120);
  assert.equal(active.lastBeat, 500);
});

/* ── the regression this guards: two events finalizing the same stored
   session at once (left-video racing the idle tick, or a handover) both read
   it before either cleared it, and the row was inserted twice ── */
test('serialize runs overlapping read-modify-write tasks one after another', async () => {
  const run = serialize();
  let stored = { seconds: 120 };
  const inserted = [];
  const finalize = async () => {
    const s = stored;
    await new Promise((r) => setTimeout(r, 5)); // the insert's network await
    if (s) inserted.push(s);
    stored = null;
  };
  await Promise.all([run(finalize), run(finalize)]);
  assert.equal(inserted.length, 1);
});

test('serialize keeps going after a task throws, and still reports the error', async () => {
  const run = serialize();
  await assert.rejects(run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await run(async () => 'next'), 'next');
});

/* ── weekly duplicate sweep: a row saved twice (a race, or a retry of an
   insert that had in fact landed) is deleted, while the old one-row-per-
   minute fragments — identical 60s rows ~60s apart, each a real minute —
   are kept ── */
const row = (id, created_at, extra = {}) => ({
  id, created_at, date: '2026-09-24', seconds: 240, language: 'fr', type: 'youtube',
  title: 'Calanques', channel: 'c', video_id: 'v', source: 'auto', season: null, episode: null, ...extra,
});

test('an identical row saved milliseconds after its twin is a duplicate; the earliest is kept', () => {
  const rows = [
    row('b', '2026-09-24T01:23:23.300+00:00'),
    row('a', '2026-09-24T01:23:23.000+00:00'),
  ];
  assert.deepEqual(findDuplicateSessions(rows), ['b']);
});

test('a 240s row saved 5s after its twin is a duplicate — nobody watches 240s in 5s', () => {
  const rows = [row('a', '2026-09-24T01:23:23+00:00'), row('b', '2026-09-24T01:23:28+00:00')];
  assert.deepEqual(findDuplicateSessions(rows), ['b']);
});

test('one-minute fragments a minute apart are real time, even with clock jitter', () => {
  const rows = [
    row('a', '2026-07-21T17:16:07.0+00:00', { seconds: 60 }),
    row('b', '2026-07-21T17:17:06.8+00:00', { seconds: 60 }),
    row('c', '2026-07-21T17:17:58.1+00:00', { seconds: 60 }),
  ];
  assert.deepEqual(findDuplicateSessions(rows), []);
});

test('rows differing in any field are never duplicates of each other', () => {
  const rows = [
    row('a', '2026-09-24T01:23:23+00:00'),
    row('b', '2026-09-24T01:23:23+00:00', { seconds: 241 }),
    row('c', '2026-09-24T01:23:23+00:00', { language: 'en' }),
    row('d', '2026-09-24T01:23:23+00:00', { date: '2026-09-25' }),
  ];
  assert.deepEqual(findDuplicateSessions(rows), []);
});

test('several copies of one row are measured against the kept original, not each other', () => {
  const rows = [
    row('a', '2026-09-24T01:00:00+00:00'),
    row('b', '2026-09-24T01:00:01+00:00'),
    row('c', '2026-09-24T01:00:02+00:00'),
    row('d', '2026-09-24T02:00:00+00:00'), // a genuine rewatch an hour later
  ];
  assert.deepEqual(findDuplicateSessions(rows).sort(), ['b', 'c']);
});
