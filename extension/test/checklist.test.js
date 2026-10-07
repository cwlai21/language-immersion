// Sanity suite for extension/checklist.js — the engine behind both trip
// pages. It is DOM code, so this drives it against a stub document: enough to
// catch the things that silently break a page, which is exactly what happened
// when the engine was extracted (every page still mirrored its ticks under the
// name 'trip', so Singapore would have written into the France list's lane).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'checklist.js'), 'utf8');

// A document stub with just the surface the engine touches.
function fakeDom() {
  const make = (tag) => {
    const el = {
      tagName: tag, children: [], className: '', textContent: '', innerHTML: '',
      style: {}, dataset: {}, checked: false, type: '', title: '', hidden: false,
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      append(...kids) { this.children.push(...kids); },
      appendChild(kid) { this.children.push(kid); return kid; },
      addEventListener() {},
    };
    return el;
  };
  const byId = { sections: make('div'), progress: make('span') };
  return {
    document: {
      getElementById: (id) => byId[id] || (byId[id] = make('div')),
      createElement: make,
    },
    byId,
  };
}

// Run the engine with every collaborator stubbed, and report what it did.
function run({ sections, kvKey = 'test-list', surface = 'test', stored = {} }) {
  const dom = fakeDom();
  const calls = { saved: [], mirrored: [], surfaces: [], timers: [] };
  const sandbox = {
    document: dom.document,
    localStorage: { store: {}, getItem(k) { return this.store[k] ?? null; },
                    setItem(k, v) { this.store[k] = v; } },
    sbRequest: async (query, opts) => {
      if (opts && opts.method === 'POST') { calls.saved.push(JSON.parse(opts.body.value)); return []; }
      return [{ value: JSON.stringify(stored) }];
    },
    registerSurface: (s) => calls.surfaces.push(s),
    mirrorTick: (origin, link, done) => calls.mirrored.push({ origin, link, done }),
    doneElsewhere: async () => new Set(),
    contentLinks: (item) => ({ videoIds: [item.id], shows: [] }),
    formatDuration: (s) => (s ? `${Math.round(s / 60)} min` : ''),
    approxLength: (s) => (s ? `≈${Math.round(s / 60)} min` : ''),
    t: (k) => k,
    // Captured rather than run: the engine schedules a two-minute retry for a
    // mirror that reached nothing, and a real timer would hold the test open.
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return 0; },
  };
  const names = Object.keys(sandbox);
  // eslint-disable-next-line no-new-func
  new Function(...names, `${SOURCE}\n;initChecklist(${JSON.stringify({ sections, kvKey, surface })});`)
    (...names.map((n) => sandbox[n]));
  return { dom, calls };
}

const SECTIONS = [{
  title: 'Singapour',
  blurb: 'test',
  items: [
    { id: 'a', lang: 'fr', kind: '▶️', sec: 600, title: 'A', desc: 'd', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' },
    { id: 'b', lang: 'en', kind: '🎙️', approx: 1800, show: 'Show', title: 'B', desc: 'd', url: 'https://podcasts.apple.com/fr/podcast/id1' },
  ],
}];

test('a page registers itself under its own surface name, not a hardcoded one', () => {
  const { calls } = run({ sections: SECTIONS, surface: 'singapore' });
  assert.equal(calls.surfaces.length, 1);
  assert.equal(calls.surfaces[0].name, 'singapore');
  assert.equal(calls.surfaces[0].kv, 'test-list');
});

test('two pages keep separate storage keys and separate surfaces', () => {
  const a = run({ sections: SECTIONS, kvKey: 'trip-checklist', surface: 'trip' });
  const b = run({ sections: SECTIONS, kvKey: 'singapore-checklist', surface: 'singapore' });
  assert.notEqual(a.calls.surfaces[0].kv, b.calls.surfaces[0].kv);
  assert.notEqual(a.calls.surfaces[0].name, b.calls.surfaces[0].name);
});

test('the surface answers with the ids of items the link names, and no others', () => {
  const { calls } = run({ sections: SECTIONS, surface: 'singapore' });
  const { keys } = calls.surfaces[0];
  assert.deepEqual(keys({ videoIds: ['a'], shows: [] }), ['a']);
  assert.deepEqual(keys({ videoIds: ['nothing-here'], shows: [] }), []);
});

test('patching marks only what changed, and reports nothing when it already matched', () => {
  const { calls } = run({ sections: SECTIONS, surface: 'singapore' });
  const { patch } = calls.surfaces[0];
  assert.deepEqual(patch({}, ['a'], true), { a: true });
  assert.equal(patch({ a: true }, ['a'], true), null);
  // Unticking records false rather than dropping the key: "I cleared this on
  // purpose" is an answer, and reconcile() must not fill it back in.
  assert.deepEqual(patch({ a: true }, ['a'], false), { a: false });
});

test('the list renders a row per item and a progress count', async () => {
  const { dom } = run({ sections: SECTIONS, surface: 'singapore', stored: { a: true } });
  // init() loads the stored ticks before painting, so the first render lands a
  // microtask later — the page is never blank by the time anyone sees it.
  await new Promise((r) => setImmediate(r));
  const rendered = dom.byId.sections.children;
  assert.equal(rendered.length, 1, 'one section');
  const rows = rendered[0].children.filter((c) => (c.className || '').startsWith('trip-item'));
  assert.equal(rows.length, 2, 'two items');
  assert.equal(dom.byId.progress.textContent, '1 / 2 ✓');
});

/* ── Reconcile, both directions ── */
// The pull half catches ticks made elsewhere. The push half catches ticks of
// ours the others never heard about — which is what happens whenever an item
// is ticked before its session exists, the normal case for a video ticked
// while still watching it: sessions are only written after 90 seconds idle.
function runReconcile({ stored = {}, doneElsewhere = new Set(), reached = 1 }) {
  const dom = fakeDom();
  const calls = { mirrored: [], saved: [], timers: [] };
  const sandbox = {
    document: dom.document,
    localStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; } },
    sbRequest: async (query, opts) => {
      if (opts && opts.method === 'POST') { calls.saved.push(JSON.parse(opts.body.value)); return []; }
      return [{ value: JSON.stringify(stored) }];
    },
    registerSurface: () => {},
    mirrorTick: async (origin, link, done) => {
      calls.mirrored.push({ origin, ids: link.videoIds, done });
      return reached;   // how many other lists it got to; 0 means nobody heard
    },
    doneElsewhere: async () => doneElsewhere,
    contentLinks: (item) => ({ videoIds: [item.id], shows: [] }),
    formatDuration: () => '', approxLength: () => '', t: (k) => k,
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return 0; },
  };
  const names = Object.keys(sandbox);
  // eslint-disable-next-line no-new-func
  new Function(...names, `${SOURCE}\n;initChecklist(${JSON.stringify({ sections: SECTIONS, kvKey: 'k', surface: 'singapore' })});`)
    (...names.map((n) => sandbox[n]));
  return { calls, dom };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a tick the other lists never heard about is pushed to them again', async () => {
  // Exactly the Lighting-the-GP case: ticked here, no session yet, so the
  // mirror reached nothing and the dashboard kept showing it unwatched.
  const { calls } = runReconcile({ stored: { a: true }, doneElsewhere: new Set() });
  await settle();
  assert.deepEqual(calls.mirrored, [{ origin: 'singapore', ids: ['a'], done: true }]);
});

test('a tick the others already know about is not pushed again', async () => {
  const { calls } = runReconcile({ stored: { a: true }, doneElsewhere: new Set(['a']) });
  await settle();
  assert.deepEqual(calls.mirrored, [], 'nothing to say');
});

test('an item cleared on purpose is never re-pushed', async () => {
  // false, not missing — unticking anywhere mirrors, so this is a decision.
  const { calls } = runReconcile({ stored: { a: false }, doneElsewhere: new Set() });
  await settle();
  assert.deepEqual(calls.mirrored, []);
});

test('pulling still fills in only the items we have no answer for', async () => {
  const { calls } = runReconcile({ stored: { b: false }, doneElsewhere: new Set(['a', 'b']) });
  await settle();
  const saved = calls.saved.at(-1);
  assert.equal(saved.a, true, 'unknown item adopts the others\' answer');
  assert.equal(saved.b, false, 'deliberately cleared stays cleared');
});

test('a re-push that still reaches nobody asks again later, instead of waiting for the next visit', async () => {
  // The session is written 90 seconds after playback goes idle, so a video
  // ticked while still watching it mirrors to nothing — and the dashboard
  // would show it unwatched until this page was next opened.
  const { calls } = runReconcile({ stored: { a: true }, doneElsewhere: new Set(), reached: 0 });
  await settle();
  assert.equal(calls.mirrored.length, 1, 'it tried');
  assert.equal(calls.timers.length, 1, 'and scheduled a retry');
  assert.equal(calls.timers[0].ms, 120000, 'two minutes — long enough for the session to land');
});

test('a re-push that got through does not schedule anything', async () => {
  const { calls } = runReconcile({ stored: { a: true }, doneElsewhere: new Set(), reached: 1 });
  await settle();
  assert.deepEqual(calls.timers, []);
});

test('retries are bounded, so a page left open all day does not ask forever', async () => {
  const { calls } = runReconcile({ stored: { a: true }, doneElsewhere: new Set(), reached: 0 });
  await settle();
  for (let i = 0; i < 20; i++) {
    const timer = calls.timers.at(-1);
    if (!timer) break;
    await timer.fn();        // what the clock would have run
    await settle();
  }
  assert.ok(calls.timers.length <= 5, `asked ${calls.timers.length} times, expected no more than 5`);
  assert.ok(calls.timers.length >= 2, 'but it did try more than once');
});
