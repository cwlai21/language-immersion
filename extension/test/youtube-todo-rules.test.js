// Sanity suite for extension/youtube-todo-rules.js — the pure planning logic
// for the YouTube-playlist → "À regarder" sync. Run with `node --test
// extension/test` (see the git hooks).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planYoutubeTodoSync } = require('../youtube-todo-rules.js');

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
