// Sanity suite for extension/series-rules.js — guards against the
// finalize-and-restart fragmentation bug found in "The Faceoff" S1E7's
// tracking (35 rows of 30-60s each for one ~47-minute viewing, because a
// flaky episode-number DOM read was treated as "you switched episodes").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seriesChanged, applySeriesHeartbeat } = require('../series-rules.js');

test('no current series means nothing has "changed" yet', () => {
  assert.equal(seriesChanged(null, { name: 'Show', episode: 1 }), false);
});

test('a genuinely different show name is a change', () => {
  const current = { name: 'Show A', episode: 1 };
  assert.equal(seriesChanged(current, { name: 'Show B', episode: 1 }), true);
});

test('a genuinely different episode number is a change', () => {
  const current = { name: 'Show', episode: 7 };
  assert.equal(seriesChanged(current, { name: 'Show', episode: 8 }), true);
});

test('a flaky null episode read is NOT a change (the regression case)', () => {
  // This is exactly what fragmented "The Faceoff" S1E7 into 35 rows: a
  // transient DOM miss reported episode: null mid-episode, and the old
  // code finalized-and-restarted the accumulator on every one of these.
  const current = { name: '校園之外第一季', episode: 7 };
  assert.equal(seriesChanged(current, { name: '校園之外第一季', episode: null }), false);
});

test('same show, same episode is not a change', () => {
  const current = { name: 'Show', episode: 7 };
  assert.equal(seriesChanged(current, { name: 'Show', episode: 7 }), false);
});

test('a null episode does not mask a real show-name change', () => {
  const current = { name: 'Show A', episode: 7 };
  assert.equal(seriesChanged(current, { name: 'Show B', episode: null }), true);
});

/* ── applySeriesHeartbeat: two series tabs open at once must never
 * interfere with each other (the "傳奇辦公室" / "校園之外第一季" bug) ── */
test('a heartbeat from a second tab does not finalize or touch the first tab\'s series', () => {
  let state = {};
  ({ seriesByTab: state } = applySeriesHeartbeat(
    state, 'tabA', { name: '傳奇辦公室', episode: 1 }, 45, 1000, '2026-07-21'
  ));
  const beforeSecondTab = state.tabA;

  const result = applySeriesHeartbeat(
    state, 'tabB', { name: '校園之外第一季', episode: 8 }, 60, 2000, '2026-07-21'
  );

  assert.equal(result.finalized, null); // tab A never finalized by tab B's beat
  assert.deepEqual(result.seriesByTab.tabA, beforeSecondTab); // tab A untouched
  assert.equal(result.seriesByTab.tabB.name, '校園之外第一季');
  assert.equal(result.seriesByTab.tabB.seconds, 60);
});

test('interleaved heartbeats from two tabs accumulate independently', () => {
  let state = {};
  ({ seriesByTab: state } = applySeriesHeartbeat(state, 'tabA', { name: 'Show A', episode: 1 }, 15, 1000, 'd'));
  ({ seriesByTab: state } = applySeriesHeartbeat(state, 'tabB', { name: 'Show B', episode: 1 }, 15, 1015, 'd'));
  ({ seriesByTab: state } = applySeriesHeartbeat(state, 'tabA', { name: 'Show A', episode: 1 }, 15, 2000, 'd'));
  ({ seriesByTab: state } = applySeriesHeartbeat(state, 'tabB', { name: 'Show B', episode: 1 }, 15, 2015, 'd'));

  assert.equal(state.tabA.seconds, 30);
  assert.equal(state.tabB.seconds, 30);
});

test('a real show change within the SAME tab still finalizes normally', () => {
  let state = {};
  ({ seriesByTab: state } = applySeriesHeartbeat(state, 'tabA', { name: 'Show A', episode: 1 }, 45, 1000, 'd'));
  const result = applySeriesHeartbeat(state, 'tabA', { name: 'Show B', episode: 1 }, 30, 2000, 'd');

  assert.equal(result.finalized.name, 'Show A');
  assert.equal(result.finalized.seconds, 45);
  assert.equal(result.seriesByTab.tabA.name, 'Show B');
  assert.equal(result.seriesByTab.tabA.seconds, 30);
});

test('applySeriesHeartbeat does not mutate the input map', () => {
  const state = { tabA: { name: 'Show A', episode: 1, seconds: 10 } };
  const snapshot = JSON.parse(JSON.stringify(state));
  applySeriesHeartbeat(state, 'tabA', { name: 'Show A', episode: 1 }, 15, 1000, 'd');
  assert.deepEqual(state, snapshot);
});
