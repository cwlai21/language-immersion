// Sanity suite for extension/list-rules.js — pure interval-merging logic
// shared by the Recent Sessions list and the CSV export. Run with
// `node --test extension/test` (see .githooks/pre-commit, pre-push).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntervals, sessionInterval, groupSameContent, sessionRowFields } = require('../list-rules.js');
const { t } = require('../i18n.js');

test('merges two overlapping intervals into one', () => {
  assert.deepEqual(mergeIntervals([[0, 10000], [5000, 15000]]), [[0, 15000]]);
});

test('merges intervals exactly 2 minutes apart', () => {
  assert.deepEqual(mergeIntervals([[0, 10000], [130000, 140000]]), [[0, 140000]]);
});

test('keeps intervals more than 2 minutes apart separate', () => {
  assert.deepEqual(mergeIntervals([[0, 10000], [130001, 140000]]), [[0, 10000], [130001, 140000]]);
});

test('sorts unsorted input before merging', () => {
  assert.deepEqual(mergeIntervals([[130000, 140000], [0, 10000]]), [[0, 140000]]);
});

test('a fully-contained interval does not shrink the outer one', () => {
  assert.deepEqual(mergeIntervals([[0, 20000], [5000, 8000]]), [[0, 20000]]);
});

test('empty input yields no intervals', () => {
  assert.deepEqual(mergeIntervals([]), []);
});

test('a single interval passes through unchanged', () => {
  assert.deepEqual(mergeIntervals([[0, 10000]]), [[0, 10000]]);
});

/* ── sessionInterval: clock range for a row, or null when meaningless ── */
test('sessionInterval is null with no created_at', () => {
  assert.equal(sessionInterval({ source: 'auto', seconds: 60 }), null);
});

test('sessionInterval is null for sources with no useful clock (manual/anki/import)', () => {
  for (const source of ['manual', 'anki', 'import']) {
    assert.equal(sessionInterval({ source, seconds: 60, created_at: '2026-07-20T10:00:00Z' }), null);
  }
});

test('spotify sessions are created at the start, so the interval runs forward', () => {
  const created = new Date('2026-07-20T10:00:00Z').getTime();
  const [start, end] = sessionInterval({ source: 'spotify', seconds: 120, created_at: '2026-07-20T10:00:00Z' });
  assert.equal(start, created);
  assert.equal(end, created + 120000);
});

test('auto/timer/apple sessions are created at the end, so the interval runs backward', () => {
  const created = new Date('2026-07-20T10:00:00Z').getTime();
  for (const source of ['auto', 'timer', 'apple']) {
    const [start, end] = sessionInterval({ source, seconds: 120, created_at: '2026-07-20T10:00:00Z' });
    assert.equal(start, created - 120000);
    assert.equal(end, created);
  }
});

/* ── groupSameContent: same content across days groups into one row ── */
test('groups the same titled content across two different days', () => {
  const sessions = [
    { id: 1, date: '2026-07-20', language: 'fr', type: 'podcast', title: 'InnerFrench', channel: 'InnerFrench', source: 'auto' },
    { id: 2, date: '2026-07-21', language: 'fr', type: 'podcast', title: 'InnerFrench', channel: 'InnerFrench', source: 'auto' },
  ];
  const groups = groupSameContent(sessions);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});

test('anki rows stay one-per-day even with an identical title', () => {
  const sessions = [
    { id: 1, date: '2026-07-20', language: 'fr', type: 'anki', title: 'Anki reviews', source: 'anki' },
    { id: 2, date: '2026-07-21', language: 'fr', type: 'anki', title: 'Anki reviews', source: 'anki' },
  ];
  const groups = groupSameContent(sessions);
  assert.equal(groups.length, 2);
});

test('untitled rows never merge, even on the same day', () => {
  const sessions = [
    { id: 1, date: '2026-07-20', language: 'fr', type: 'youtube', title: '', channel: '', source: 'auto' },
    { id: 2, date: '2026-07-20', language: 'fr', type: 'youtube', title: '', channel: '', source: 'auto' },
  ];
  const groups = groupSameContent(sessions);
  assert.equal(groups.length, 2);
});

test('same title from two different channels stays separate', () => {
  const sessions = [
    { id: 1, date: '2026-07-20', language: 'fr', type: 'series', title: 'Pilot', channel: 'Show A', source: 'auto' },
    { id: 2, date: '2026-07-20', language: 'fr', type: 'series', title: 'Pilot', channel: 'Show B', source: 'auto' },
  ];
  const groups = groupSameContent(sessions);
  assert.equal(groups.length, 2);
});

/* ── sessionRowFields: shared display fields for the list + CSV export ── */
test('a row with no title falls back to the untitled label', () => {
  const fields = sessionRowFields([{ date: '2026-07-20', seconds: 60, source: 'manual' }]);
  assert.equal(fields.title, t('untitled'));
});

test('a series row with season/episode gets an SxEy prefix', () => {
  const fields = sessionRowFields([{
    date: '2026-07-20', seconds: 60, source: 'auto',
    type: 'series', title: 'Pilot', season: 1, episode: 3,
  }]);
  assert.equal(fields.title, 'S1E3 · Pilot');
});

test('a series row with no season/episode has no prefix', () => {
  const fields = sessionRowFields([{ date: '2026-07-20', seconds: 60, source: 'auto', type: 'series', title: 'Pilot' }]);
  assert.equal(fields.title, 'Pilot');
});

test('a single-day group shows one date and one combined duration', () => {
  const fields = sessionRowFields([
    { date: '2026-07-20', seconds: 600, source: 'manual', title: 'X' },
    { date: '2026-07-20', seconds: 300, source: 'manual', title: 'X' },
  ]);
  assert.equal(fields.dateText, '2026-07-20');
  assert.equal(fields.durationText, '15m');
});

test('a multi-day group shows a date range and per-day durations, not one combined total', () => {
  const fields = sessionRowFields([
    { date: '2026-07-20', seconds: 2220, source: 'manual', title: 'X' }, // 37m
    { date: '2026-07-21', seconds: 1080, source: 'manual', title: 'X' }, // 18m
  ]);
  assert.equal(fields.dateText, '2026-07-20 → 2026-07-21');
  assert.equal(fields.durationText, '37m + 18m');
});

test('auto flag is set for auto/anki/apple/spotify sources, not manual', () => {
  for (const source of ['auto', 'anki', 'apple', 'spotify']) {
    assert.equal(sessionRowFields([{ date: '2026-07-20', seconds: 60, source, title: 'X' }]).auto, true);
  }
  assert.equal(sessionRowFields([{ date: '2026-07-20', seconds: 60, source: 'manual', title: 'X' }]).auto, false);
});

test('imported flag is set only for source import', () => {
  assert.equal(sessionRowFields([{ date: '2026-07-20', seconds: 60, source: 'import', title: 'X' }]).imported, true);
  assert.equal(sessionRowFields([{ date: '2026-07-20', seconds: 60, source: 'manual', title: 'X' }]).imported, false);
});

test('a single-day auto row shows its clock range as timeText', () => {
  const fields = sessionRowFields([{
    date: '2026-07-20', seconds: 1800, source: 'auto', title: 'X',
    created_at: '2026-07-20T10:30:00', // auto: created at end, so 10:00–10:30
  }]);
  assert.equal(fields.timeText, '10:00–10:30');
});

test('a multi-day group has no timeText even if rows have clock data', () => {
  const fields = sessionRowFields([
    { date: '2026-07-20', seconds: 60, source: 'auto', title: 'X', created_at: '2026-07-20T10:30:00' },
    { date: '2026-07-21', seconds: 60, source: 'auto', title: 'X', created_at: '2026-07-21T10:30:00' },
  ]);
  assert.equal(fields.timeText, '');
});
