// Sanity suite for extension/caption-rules.js — guards the case that made an
// English tennis Short (ghDH-zbNdzY) untracked: YouTube auto-generated 21
// caption tracks for it, every one kind:"asr", with Japanese listed first.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spokenCaptionLanguage } = require('../caption-rules.js');

// The real shape of that Short's player response, trimmed to what we read.
function multiLanguageShort() {
  const langs = ['ja', 'id', 'hi', 'es-US', 'iw', 'ta', 'bn', 'fr-FR', 'pl', 'ar',
    'ru', 'en', 'pa', 'te', 'uk', 'ml', 'nl-NL', 'it', 'pt-BR', 'de-DE', 'ko'];
  const audioIds = ['ru.10', 'en-US.4', 'pt-BR.10', 'uk.10', 'fr-FR.10'];
  return {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: langs.map((l) => ({ languageCode: l, kind: 'asr', vssId: `a.${l}` })),
        audioTracks: audioIds.map((id) => ({ audioTrackId: id, defaultCaptionTrackIndex: 11 })),
        defaultAudioTrackIndex: 1, // "en-US.4"
      },
    },
  };
}

test('the spoken language is the default audio track\'s caption, not the first one listed', () => {
  assert.equal(spokenCaptionLanguage(multiLanguageShort()), 'en');
});

test('a French video with the same 21-track treatment reads as French', () => {
  const pr = multiLanguageShort();
  const r = pr.captions.playerCaptionsTracklistRenderer;
  r.defaultAudioTrackIndex = 4;                        // "fr-FR.10"
  r.audioTracks.forEach((a) => { a.defaultCaptionTrackIndex = 7; });  // "fr-FR"
  assert.equal(spokenCaptionLanguage(pr), 'fr-FR');
});

test('with no usable caption pairing, the audio track id names the language', () => {
  const pr = multiLanguageShort();
  const r = pr.captions.playerCaptionsTracklistRenderer;
  r.audioTracks.forEach((a) => { delete a.defaultCaptionTrackIndex; });
  assert.equal(spokenCaptionLanguage(pr), 'en-US');
});

test('an ordinary single-ASR video still works the old way', () => {
  const pr = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: 'fr', kind: 'asr' },
          { languageCode: 'en' }, // a human-authored translation, not the audio
        ],
      },
    },
  };
  assert.equal(spokenCaptionLanguage(pr), 'fr');
});

test('human-authored captions alone say nothing about the audio', () => {
  const pr = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ languageCode: 'en' }, { languageCode: 'fr' }],
      },
    },
  };
  assert.equal(spokenCaptionLanguage(pr), null);
});

test('a video with no captions yet is null, not a guess', () => {
  assert.equal(spokenCaptionLanguage({ captions: {} }), null);
  assert.equal(spokenCaptionLanguage({}), null);
  assert.equal(spokenCaptionLanguage(null), null);
});

test('the answer feeds asrLanguage, so a regional code still resolves', () => {
  const { asrLanguage } = require('../lang-detect.js');
  const pr = multiLanguageShort();
  assert.equal(asrLanguage({ asrLang: spokenCaptionLanguage(pr) }), 'en');
  const r = pr.captions.playerCaptionsTracklistRenderer;
  r.audioTracks.forEach((a) => { a.defaultCaptionTrackIndex = 7; });  // "fr-FR"
  assert.equal(asrLanguage({ asrLang: spokenCaptionLanguage(pr) }), 'fr');
  r.audioTracks.forEach((a) => { a.defaultCaptionTrackIndex = 0; });  // "ja"
  assert.equal(asrLanguage({ asrLang: spokenCaptionLanguage(pr) }), 'other');
});
