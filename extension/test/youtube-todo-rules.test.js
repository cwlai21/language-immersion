// Sanity suite for extension/youtube-todo-rules.js — the pure planning logic
// for the YouTube-playlist → "À regarder" sync. Run with `node --test
// extension/test` (see the git hooks).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planYoutubeTodoSync, parseIsoDuration, formatDuration } = require('../youtube-todo-rules.js');

const item = (videoId, playlistItemId, extra = {}) =>
  ({ videoId, playlistItemId, title: 't-' + videoId, channel: 'c', ...extra });

test('a new, unwatched video is imported and scheduled for removal', () => {
  const { toAdd, removeItemIds } = planYoutubeTodoSync(
    [item('V1', 'PI1')], new Set(), {}, 'fr', 1000,
  );
  assert.deepEqual(Object.keys(toAdd), ['V1']);
  assert.equal(toAdd.V1.lang, 'fr');
  assert.equal(toAdd.V1.done, false);
  assert.equal(toAdd.V1.addedAt, 1000);
  assert.deepEqual(removeItemIds, ['PI1']);
});

test('addedAt folds in the playlist position so a later-added video sorts first', () => {
  const { toAdd } = planYoutubeTodoSync(
    [item('OLD', 'PIa', { position: 0 }), item('NEW', 'PIb', { position: 5 })],
    new Set(), {}, 'fr', 1000,
  );
  assert.equal(toAdd.OLD.addedAt, 1000);
  assert.equal(toAdd.NEW.addedAt, 1005); // higher position → higher addedAt → top of a newest-first list
});

test('a video length rides along into the todo entry', () => {
  const { toAdd } = planYoutubeTodoSync(
    [item('V1', 'PI1', { durationSec: 754 })], new Set(), {}, 'fr', 1000,
  );
  assert.equal(toAdd.V1.durationSec, 754);
});

test('an unknown video length is recorded as null, not dropped', () => {
  const { toAdd } = planYoutubeTodoSync([item('V1', 'PI1')], new Set(), {}, 'fr', 1000);
  assert.equal(toAdd.V1.durationSec, null);
});

test('an already-watched video is left alone (not imported, not removed)', () => {
  const { toAdd, removeItemIds } = planYoutubeTodoSync(
    [item('V1', 'PI1')], new Set(['V1']), {},
  );
  assert.deepEqual(toAdd, {});
  assert.deepEqual(removeItemIds, []);
});

test('a video already in the todo is not re-imported but is removed again', () => {
  const { toAdd, removeItemIds } = planYoutubeTodoSync(
    [item('V1', 'PI1')], new Set(), { V1: { videoId: 'V1', done: true } },
  );
  assert.deepEqual(toAdd, {});               // keep its existing (done) state
  assert.deepEqual(removeItemIds, ['PI1']);  // retry the removal
});

test('a mixed playlist: import the new one, skip the watched one, retry the imported one', () => {
  const { toAdd, removeItemIds } = planYoutubeTodoSync(
    [item('NEW', 'PIa'), item('WATCHED', 'PIb'), item('INLIST', 'PIc')],
    new Set(['WATCHED']),
    { INLIST: { videoId: 'INLIST', done: false } },
  );
  assert.deepEqual(Object.keys(toAdd), ['NEW']);
  assert.deepEqual(removeItemIds.sort(), ['PIa', 'PIc']);
});

test('the same video twice in the playlist is imported once, both entries removed', () => {
  const { toAdd, removeItemIds } = planYoutubeTodoSync(
    [item('V1', 'PI1'), item('V1', 'PI2')], new Set(), {},
  );
  assert.deepEqual(Object.keys(toAdd), ['V1']);
  assert.deepEqual(removeItemIds, ['PI1', 'PI2']);
});

test('planYoutubeTodoSync does not mutate its inputs', () => {
  const current = { X: { videoId: 'X', done: true } };
  const tracked = new Set(['X']);
  planYoutubeTodoSync([item('V1', 'PI1')], tracked, current, 'fr', 1000);
  assert.deepEqual(current, { X: { videoId: 'X', done: true } });
  assert.deepEqual([...tracked], ['X']);
});

test('parseIsoDuration reads the YouTube duration format', () => {
  assert.equal(parseIsoDuration('PT34S'), 34);
  assert.equal(parseIsoDuration('PT12M34S'), 754);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT2H'), 7200);
  assert.equal(parseIsoDuration('P1DT1H'), 90000);
  assert.equal(parseIsoDuration('PT1M30.5S'), 91); // fractional seconds round
});

test('parseIsoDuration returns null when there is no real length', () => {
  assert.equal(parseIsoDuration('P0D'), null); // live stream
  assert.equal(parseIsoDuration(''), null);
  assert.equal(parseIsoDuration(undefined), null);
  assert.equal(parseIsoDuration('garbage'), null);
});

test('formatDuration labels lengths the way YouTube does', () => {
  assert.equal(formatDuration(34), '0:34');
  assert.equal(formatDuration(754), '12:34');
  assert.equal(formatDuration(3903), '1:05:03');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(null), '');
});
