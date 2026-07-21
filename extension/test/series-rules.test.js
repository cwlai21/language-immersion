// Sanity suite for extension/series-rules.js — guards against the
// finalize-and-restart fragmentation bug found in "The Faceoff" S1E7's
// tracking (35 rows of 30-60s each for one ~47-minute viewing, because a
// flaky episode-number DOM read was treated as "you switched episodes").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seriesChanged } = require('../series-rules.js');

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
