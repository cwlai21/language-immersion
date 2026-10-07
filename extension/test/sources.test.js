// Every shipped script parses, and the curated trip pages are well-formed.
//
// The rest of the suite tests the modules it can require(); the page scripts —
// dashboard.js, popup.js, todo.js, singapore.js, watchlist.js — are loaded by
// a <script> tag and by nothing else, so until now a syntax error in one of
// them passed both hooks and shipped. Splitting the trip pages produced
// exactly that: a stray "];" in singapore.js, caught only because it happened
// to be checked by hand.
//
// The data checks are the ones that used to be run ad hoc after every edit to
// a trip list — unique ids, every field present, no video linked twice.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXT = path.join(__dirname, '..');
const scripts = fs.readdirSync(EXT).filter((f) => f.endsWith('.js'));

test('every script in the extension parses', () => {
  assert.ok(scripts.length >= 15, `only found ${scripts.length} scripts — is the path right?`);
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(EXT, file), 'utf8');
    // Compiling without running is what `node --check` does, and all of these
    // are plain scripts rather than modules.
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), `${file} does not parse`);
  }
});

test('the vendored and generated files are checked too, not just the hand-written ones', () => {
  for (const name of ['checklist.js', 'singapore.js', 'todo.js', 'dashboard.js', 'popup.js']) {
    assert.ok(scripts.includes(name), `${name} is missing from the extension`);
  }
});

// Load a trip page the way the browser does, capturing what it hands the engine.
function loadTripPage(file) {
  const source = fs.readFileSync(path.join(EXT, file), 'utf8');
  let captured = null;
  const sandbox = { initChecklist: (config) => { captured = config; } };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: file }).runInContext(sandbox);
  assert.ok(captured, `${file} never called initChecklist`);
  return captured;
}

const PAGES = [
  { file: 'todo.js', kvKey: 'trip-checklist', surface: 'trip' },
  { file: 'singapore.js', kvKey: 'singapore-checklist', surface: 'singapore' },
];

for (const page of PAGES) {
  test(`${page.file} starts its own list, on its own key`, () => {
    const config = loadTripPage(page.file);
    assert.equal(config.kvKey, page.kvKey);
    assert.equal(config.surface, page.surface);
    assert.ok(config.sections.length, 'has sections');
  });

  test(`${page.file}: every item is complete and uniquely identified`, () => {
    const { sections } = loadTripPage(page.file);
    const items = sections.flatMap((s) => s.items);
    assert.ok(items.length, 'has items');

    const ids = new Set();
    for (const item of items) {
      const where = `${page.file} ${item.id || '(no id)'}`;
      assert.ok(item.id, `${where}: an item with no id cannot remember being ticked`);
      assert.ok(!ids.has(item.id), `${where}: duplicate id — two rows would share one tick`);
      ids.add(item.id);
      assert.ok(['fr', 'en'].includes(item.lang), `${where}: lang must be fr or en`);
      assert.ok(item.title && item.desc, `${where}: needs a title and a description`);
      assert.match(item.url, /^https?:\/\//, `${where}: needs a real link`);
      for (const field of ['sec', 'approx']) {
        if (item[field] !== undefined) {
          assert.ok(Number.isInteger(item[field]) && item[field] > 0, `${where}: ${field} must be a positive whole number of seconds`);
        }
      }
      // A length is either measured or typical, never claimed to be both.
      assert.ok(!(item.sec && item.approx), `${where}: has both sec and approx`);
    }

    for (const section of sections) {
      assert.ok(section.title && section.blurb, `${page.file}: a section needs a title and a blurb`);
    }
  });

  test(`${page.file}: no video is linked twice, so one video is one row`, () => {
    const items = loadTripPage(page.file).sections.flatMap((s) => s.items);
    const seen = new Map();
    for (const item of items) {
      const id = (/[?&]v=([\w-]{11})/.exec(item.url) || [])[1];
      if (!id) continue;
      assert.ok(!seen.has(id), `${page.file}: ${item.id} and ${seen.get(id)} both link ${id}`);
      seen.set(id, item.id);
    }
  });

  test(`${page.file}: a nested pick points at a row that exists`, () => {
    const items = loadTripPage(page.file).sections.flatMap((s) => s.items);
    const ids = new Set(items.map((i) => i.id));
    for (const item of items.filter((i) => i.from)) {
      assert.ok(ids.has(item.from), `${page.file}: ${item.id} nests under ${item.from}, which is not on this page`);
      assert.notEqual(item.from, item.id, `${page.file}: ${item.id} nests under itself`);
    }
  });
}

test('the two trip pages do not share a storage key', () => {
  const keys = PAGES.map((p) => loadTripPage(p.file).kvKey);
  assert.equal(new Set(keys).size, keys.length, 'one key per trip, or they share a progress bar');
});
