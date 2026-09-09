// Sanity suite for extension/lang-detect.js — deciding what language a video's
// audio is, and whether it counts at all. Run with `node --test extension/test`
// (see the git hooks).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  guessLangFromTitle, hasNonLatinScript, asrLanguage, trackDecision,
} = require('../lang-detect.js');

const video = (extra = {}) =>
  ({ videoId: 'V1', title: 'Some title', channel: 'A Channel', channelId: 'C1', ...extra });

/* ── The veto ───────────────────────────────────────────── */

test('hasNonLatinScript spots Chinese, Japanese and Korean', () => {
  assert.ok(hasNonLatinScript('皮卡邱I 网球发球慢动作（内外角）'));
  assert.ok(hasNonLatinScript('露營必備！The Best Camping Gear'), 'mixed still counts');
  assert.ok(hasNonLatinScript('日本語のタイトル'));
  assert.ok(hasNonLatinScript('한국어 제목'));
});

test('hasNonLatinScript leaves French and English titles alone', () => {
  assert.ok(!hasNonLatinScript("Échappées belles — « Nice, l'art de la fête »"));
  assert.ok(!hasNonLatinScript('How to control forehand DEPTH and SPIN'));
  assert.ok(!hasNonLatinScript(''));
  assert.ok(!hasNonLatinScript(undefined));
});

/* ── What YouTube says the audio is ─────────────────────── */

test('asrLanguage separates "not a language we track" from "no captions yet"', () => {
  assert.equal(asrLanguage({ asrLang: 'fr' }), 'fr');
  assert.equal(asrLanguage({ asrLang: 'en-GB' }), 'en');
  assert.equal(asrLanguage({ asrLang: 'zh-Hant' }), 'other');
  assert.equal(asrLanguage({ asrLang: null }), null, 'no track at all');
  assert.equal(asrLanguage({}), null);
});

/* ── The decision ───────────────────────────────────────── */

test('a Mandarin video mislabelled by YouTube as English is not tracked', () => {
  // The real case: one caption track, kind "asr", languageCode "en", on a
  // Mandarin tennis video.
  const v = video({ title: '皮卡邱I 网球发球慢动作（内外角）', channel: '打网球的皮卡邱', asrLang: 'en' });
  assert.equal(trackDecision(v, {}, []), null);
});

test('a bilingual Chinese title is not tracked on the strength of its English half', () => {
  const v = video({ title: '露營必備！這是我用過最好的裝備 | The Best Camping Gear You Can Buy' });
  assert.equal(guessLangFromTitle(v.title), 'en', 'the title heuristic alone would say English');
  assert.equal(trackDecision(v, {}, []), null, 'but the script settles it');
});

test('a pinned channel outranks the veto, so Chinese-named English channels still count', () => {
  const v = video({ title: '亞洲人和黑人成為死黨時會發生的事🤣', channel: '學英文的貓', asrLang: 'en' });
  assert.equal(trackDecision(v, {}, []), null, 'not tracked by default');
  assert.deepEqual(
    trackDecision(v, {}, [{ id: 'C1', name: '學英文的貓', lang: 'en' }]),
    { lang: 'en', reason: 'channel' },
  );
});

test('an explicit override still wins over everything', () => {
  const v = video({ title: '露營', asrLang: 'en' });
  assert.deepEqual(trackDecision(v, { V1: 'fr' }, []), { lang: 'fr', reason: 'override' });
  assert.equal(trackDecision(v, { V1: false }, []), null);
});

test('captions in a language we do not track stop the video, not just fail to help', () => {
  // Latin-titled so the veto is not what is being tested here.
  const v = video({ title: 'Bir Turkce video', asrLang: 'tr' });
  assert.equal(trackDecision(v, {}, []), null);
});

test('ordinary French and English videos are unaffected', () => {
  assert.deepEqual(
    trackDecision(video({ title: 'Le Comté — de la fruitière aux caves', asrLang: 'fr' }), {}, []),
    { lang: 'fr', reason: 'asr' },
  );
  assert.deepEqual(
    trackDecision(video({ title: 'Rick Steves Europe: Provence', asrLang: 'en-US' }), {}, []),
    { lang: 'en', reason: 'asr' },
  );
});

test('a video with no captions yet still falls back to its title', () => {
  const v = video({ title: 'Pourquoi les avions traversent la nuit', asrLang: null });
  assert.deepEqual(trackDecision(v, {}, []), { lang: 'fr', reason: 'title' });
});

test('a CJK channel name vetoes even when the title is Latin', () => {
  const v = video({ title: 'MLB Highlights', channel: '緯來體育台', asrLang: 'en' });
  assert.equal(trackDecision(v, {}, []), null);
});
