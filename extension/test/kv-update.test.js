// Sanity suite for watch-sync.js's kvUpdate serialization.
//
// Every kvUpdate reads a whole kv_state document, changes it, and writes it
// back. Two of those running at once both read the same state, and the second
// write erases the first's change. That is not hypothetical: ticking three
// Singapore items in a row left two of them reading "todo" on the dashboard
// while the trip page showed all three done, because mirrorTick is
// deliberately not awaited and its three updates of watch-todo overlapped.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'watch-sync.js'), 'utf8');

// Load kvUpdate against a fake server, with a settable round-trip delay.
function load({ latency = 5, failOn = () => false } = {}) {
  const docs = {};
  const stats = { reads: 0, writes: 0 };
  const sbRequest = async (query, opts) => {
    await new Promise((r) => setTimeout(r, latency));
    if (opts && opts.method === 'POST') {
      if (failOn(opts.body.key, JSON.parse(opts.body.value))) throw new Error('write refused');
      stats.writes++;
      docs[opts.body.key] = opts.body.value;
      return [];
    }
    stats.reads++;
    const key = /key=eq\.([\w-]+)/.exec(query)[1];
    return docs[key] === undefined ? [] : [{ value: docs[key] }];
  };
  const sandbox = {
    sbRequest,
    console: { ...console, warn() {}, log() {} },
    // Collaborators the module defines surfaces with; unused by these tests.
    sessionWatchKeys: () => [], contentLinks: () => ({ videoIds: [], shows: [] }),
    withDoneAt: (e) => e, normShow: (s) => s, doneItemIds: () => new Set(),
  };
  const names = Object.keys(sandbox);
  // eslint-disable-next-line no-new-func
  const kvUpdate = new Function(...names, `${SOURCE}\nreturn kvUpdate;`)(...names.map((n) => sandbox[n]));
  const read = (key) => (docs[key] === undefined ? undefined : JSON.parse(docs[key]));
  return { kvUpdate, read, stats, docs };
}

const setKey = (k, v) => (state) => ({ ...state, [k]: v });

test('three ticks fired at once all survive, instead of the last one winning', async () => {
  const { kvUpdate, read } = load();
  await Promise.all([
    kvUpdate('watch-todo', setKey('a', 'done')),
    kvUpdate('watch-todo', setKey('b', 'done')),
    kvUpdate('watch-todo', setKey('c', 'done')),
  ]);
  assert.deepEqual(read('watch-todo'), { a: 'done', b: 'done', c: 'done' });
});

test('each update sees the result of the one before it', async () => {
  const { kvUpdate, read } = load();
  const seen = [];
  const note = (k) => (state) => { seen.push(Object.keys(state).length); return { ...state, [k]: 'done' }; };
  await Promise.all([kvUpdate('k', note('a')), kvUpdate('k', note('b')), kvUpdate('k', note('c'))]);
  assert.deepEqual(seen, [0, 1, 2], 'each mutate read one more key than the last');
  assert.equal(Object.keys(read('k')).length, 3);
});

test('different documents are not held up by each other', async () => {
  const { kvUpdate, read } = load({ latency: 20 });
  const started = Date.now();
  await Promise.all([
    kvUpdate('watch-todo', setKey('a', 'done')),
    kvUpdate('video-todo', setKey('b', 'done')),
    kvUpdate('trip-checklist', setKey('c', 'done')),
  ]);
  // Serial would be three round-trips each of two hops; parallel is one.
  assert.ok(Date.now() - started < 120, 'separate keys ran concurrently');
  assert.deepEqual(read('watch-todo'), { a: 'done' });
  assert.deepEqual(read('video-todo'), { b: 'done' });
});

test('a mutate that declines to change anything writes nothing and still lets the queue move', async () => {
  const { kvUpdate, read, stats } = load();
  await kvUpdate('k', setKey('a', 'done'));
  const writesBefore = stats.writes;
  await kvUpdate('k', () => null);
  assert.equal(stats.writes, writesBefore, 'null means no write');
  await kvUpdate('k', setKey('b', 'done'));
  assert.deepEqual(read('k'), { a: 'done', b: 'done' });
});

test('a failed write does not strand everything queued behind it', async () => {
  // The chain is built on the previous promise, so an unhandled rejection in
  // one link would stop every later tick from ever running.
  const { kvUpdate, read } = load({ failOn: (key, value) => value.b === 'done' });
  const results = await Promise.allSettled([
    kvUpdate('k', setKey('a', 'done')),
    kvUpdate('k', setKey('b', 'done')),
    kvUpdate('k', setKey('c', 'done')),
  ]);
  assert.equal(results[2].status, 'fulfilled', 'the third update still ran');
  assert.deepEqual(read('k'), { a: 'done', c: 'done' });
});
