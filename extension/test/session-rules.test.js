// Sanity suite for extension/session-rules.js — the pure YouTube watch-session
// transition. Run with `node --test extension/test` (see the git hooks).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyHeartbeat } = require('../session-rules.js');

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

test('a paused heartbeat for the SAME video keeps the session alive (adds 0s, still no finalize)', () => {
  const active = { videoId: 'A', seconds: 120, lang: 'en', lastBeat: 500 };
  const step = applyHeartbeat(
    active,
    { video: vid('A'), seconds: 0, playing: false, decision: track('en') },
    NOW, DATE,
  );
  assert.equal(step.finalized, null);
  assert.equal(step.session.seconds, 120);
  assert.equal(step.session.lastBeat, NOW); // still counts as activity
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
