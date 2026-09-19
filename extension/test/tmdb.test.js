// Sanity suite for extension/tmdb.js's search-result ranking — guards the
// case where TMDB's most popular /search/tv hit for a show's name is a
// one-off film rather than the series the episode belongs to.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tmdbSearchName, tmdbTitleKey, tmdbRankShows, tmdbContenders } = require('../tmdb.js');

test('a Gimy season suffix is dropped before searching', () => {
  assert.equal(tmdbSearchName('反恐特警組第八季'), '反恐特警組');
  assert.equal(tmdbSearchName('校園之外第一季'), '校園之外');
  assert.equal(tmdbSearchName('Lupin'), 'Lupin');
});

test('titles compare without case, accents or punctuation', () => {
  assert.equal(tmdbTitleKey('Les Misérables'), tmdbTitleKey('les miserables'));
  assert.equal(tmdbTitleKey('Call My Agent!'), tmdbTitleKey('call my agent'));
  assert.notEqual(tmdbTitleKey('Lupin'), tmdbTitleKey('Lupin the 3rd'));
});

test('an exact title match beats a more popular near-match', () => {
  const results = [
    { id: 1, name: 'Lupin the 3rd' },       // TMDB's own first hit
    { id: 2, name: 'Lupin' },
  ];
  assert.deepEqual(tmdbRankShows(results, 'Lupin').map(r => r.id), [2, 1]);
});

test('an exact match on the original title counts too', () => {
  const results = [
    { id: 1, name: 'The Crimson Rivers Movie', original_name: 'Les Rivières pourpres, le film' },
    { id: 2, name: 'The Crimson Rivers', original_name: 'Les Rivières pourpres' },
  ];
  assert.deepEqual(tmdbRankShows(results, 'Les Rivières pourpres').map(r => r.id), [2, 1]);
});

test('the season suffix does not stop a title from matching exactly', () => {
  const results = [
    { id: 1, name: 'Off Campus: The Movie' },
    { id: 2, name: '校園之外', original_name: '校園之外' },
  ];
  assert.deepEqual(tmdbRankShows(results, '校園之外第一季').map(r => r.id), [2, 1]);
});

test('TMDB order is kept among equally-good matches', () => {
  const results = [
    { id: 1, name: 'Zorro' },
    { id: 2, name: 'Zorro' },
    { id: 3, name: 'Young Dracula' },
    { id: 4, name: 'Zorro' },
  ];
  assert.deepEqual(tmdbRankShows(results, 'Zorro').map(r => r.id), [1, 2, 4, 3]);
});

test('no exact match at all leaves TMDB\'s order alone', () => {
  const results = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  assert.deepEqual(tmdbRankShows(results, 'Something else').map(r => r.id), [1, 2]);
});

test('an empty or missing result set is not an error', () => {
  assert.deepEqual(tmdbRankShows([], 'Lupin'), []);
  assert.deepEqual(tmdbRankShows(undefined, 'Lupin'), []);
});

test('each ranked hit says whether it is the title that was typed', () => {
  const results = [
    { id: 1, name: 'Lupin the 3rd' },
    { id: 2, name: 'Lupin' },
  ];
  // tmdbFindShow uses this to keep a longer-running show from answering
  // under a name nobody asked about.
  assert.deepEqual(tmdbRankShows(results, 'Lupin').map(r => r.exact), [true, false]);
});

test('an exact title match rules out the near-misses below it', () => {
  // Otherwise a longer-running show with a similar name (a remake, a spin-off)
  // could answer in place of the one that was actually typed.
  const shows = [{ id: 1, exact: true }, { id: 2, exact: true }, { id: 3, exact: false }];
  assert.deepEqual(tmdbContenders(shows).map(s => s.id), [1, 2]);
});

test('with no exact match every candidate still competes', () => {
  // Chinese-titled shows never match TMDB's English name (反恐特警組 /
  // "S.W.A.T."), so the whole shortlist has to stay in the running.
  const shows = [{ id: 1, exact: false }, { id: 2, exact: false }];
  assert.deepEqual(tmdbContenders(shows).map(s => s.id), [1, 2]);
  assert.deepEqual(tmdbContenders([]), []);
});
