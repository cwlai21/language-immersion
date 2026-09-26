// The same scripts reach a page two ways: the manifest injects them on a
// real page load, and background.js re-injects them when a tab is found
// script-less (after an extension reload, which orphans every open tab).
// Those two lists have to agree.
//
// They did not once. caption-rules.js was added to the manifest's MAIN-world
// entry but not to healYouTubeTab's executeScript, so a healed tab got
// page-bridge.js into a world where the function it calls had never been
// defined. probe() threw on every run, no video info was ever dispatched,
// and every YouTube page silently stopped being tracked — with the popup
// truthfully reporting "no video". Nothing else in the suite can see this:
// both files parse, both are correct, they are just not shipped together.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');

// Every chrome.scripting.executeScript({...}) call that names files, as
// { files: [...], world: 'MAIN' | 'ISOLATED' }.
function injectionCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/executeScript\(\{/g)) {
    const end = src.indexOf('});', m.index);
    const body = src.slice(m.index, end);
    const files = body.match(/files:\s*\[([^\]]*)\]/);
    if (!files) continue; // func:-based probe, not a file injection
    calls.push({
      files: files[1].split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
      world: (body.match(/world:\s*['"](\w+)['"]/) || [, 'ISOLATED'])[1],
    });
  }
  return calls;
}

// The manifest's content_scripts, keyed the same way.
function manifestEntries(hostFragment) {
  return (manifest.content_scripts || [])
    .filter((cs) => (cs.matches || []).some((m) => m.includes(hostFragment)))
    .map((cs) => ({ files: cs.js || [], world: cs.world || 'ISOLATED' }));
}

const calls = injectionCalls(background);

test('background.js injects files at all (the parser still matches the source)', () => {
  assert.ok(calls.length >= 2, `expected file injections in background.js, parsed ${calls.length}`);
  assert.ok(calls.some((c) => c.world === 'MAIN'), 'no MAIN-world injection found to compare');
});

test('the YouTube MAIN-world scripts are re-injected exactly as the manifest loads them', () => {
  const [fromManifest] = manifestEntries('youtube.com').filter((e) => e.world === 'MAIN');
  assert.ok(fromManifest, 'manifest has no MAIN-world entry for youtube.com');
  for (const call of calls.filter((c) => c.world === 'MAIN')) {
    // Order matters as much as membership: caption-rules.js defines what
    // page-bridge.js calls, so it has to be injected first.
    assert.deepEqual(call.files, fromManifest.files,
      'background.js re-injects a different MAIN-world set than the manifest loads');
  }
});

test('the YouTube isolated-world scripts match too', () => {
  const [fromManifest] = manifestEntries('youtube.com').filter((e) => e.world === 'ISOLATED');
  assert.ok(fromManifest, 'manifest has no isolated-world entry for youtube.com');
  const healed = calls.filter((c) => c.world === 'ISOLATED' && c.files.includes('content.js'));
  assert.ok(healed.length, 'nothing re-injects content.js');
  for (const call of healed) assert.deepEqual(call.files, fromManifest.files);
});

test('the streaming-site script is re-injected as the manifest loads it', () => {
  const [fromManifest] = manifestEntries('netflix.com');
  assert.ok(fromManifest, 'manifest has no entry for the streaming sites');
  const healed = calls.filter((c) => c.files.includes('series-detect.js'));
  assert.ok(healed.length, 'nothing re-injects series-detect.js');
  for (const call of healed) assert.deepEqual(call.files, fromManifest.files);
});

test('every script either list names is actually in the extension', () => {
  const named = new Set([
    ...calls.flatMap((c) => c.files),
    ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
    ...(manifest.background ? [manifest.background.service_worker] : []),
  ]);
  for (const file of named) {
    assert.ok(fs.existsSync(path.join(EXT, file)), `${file} is injected but does not exist`);
  }
});

// The worker's own imports are a third way a file reaches a runtime, and a
// missing one there takes the whole service worker down on startup.
test('every importScripts file in the worker exists', () => {
  const imports = background.match(/importScripts\(([^)]*)\)/);
  assert.ok(imports, 'background.js no longer calls importScripts — update this test');
  const files = imports[1].split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(files.length >= 3, `parsed only ${files.length} imports`);
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(EXT, file)), `importScripts('${file}') has no such file`);
  }
});
