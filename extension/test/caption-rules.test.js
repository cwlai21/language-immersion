// Sanity suite for extension/caption-rules.js — guards the case that made an
// English tennis Short (ghDH-zbNdzY) untracked: YouTube auto-generated 21
// caption tracks for it, every one kind:"asr", with Japanese listed first.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spokenCaptionLanguage } = require('../caption-rules.js');
const { asrLanguage } = require('../lang-detect.js');

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

test('the spoken language comes from the default audio track, not whichever caption is listed first', () => {
  // Japanese heads the caption list; the audio that plays is "en-US.4".
  assert.equal(spokenCaptionLanguage(multiLanguageShort()), 'en-US');
  assert.equal(asrLanguage({ asrLang: spokenCaptionLanguage(multiLanguageShort()) }), 'en');
});

test('a French video with the same 21-track treatment reads as French', () => {
  const pr = multiLanguageShort();
  pr.captions.playerCaptionsTracklistRenderer.defaultAudioTrackIndex = 4;  // "fr-FR.10"
  assert.equal(spokenCaptionLanguage(pr), 'fr-FR');
});

test('with no track id to read, the caption it pairs with is the fallback', () => {
  const pr = multiLanguageShort();
  const r = pr.captions.playerCaptionsTracklistRenderer;
  r.audioTracks.forEach((a) => { delete a.audioTrackId; });
  assert.equal(spokenCaptionLanguage(pr), 'en');   // caption track 11
});

test('the audio track id beats the caption it points at, when the two disagree', () => {
  // L'Overcut's Singapore circuit preview: French title, French audio, French
  // captions written by hand — and the French audio track points at the
  // English auto-translation, which is what announced the video as English.
  const pr = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: 'fr' },                    // written by the channel
          { languageCode: 'fr', kind: 'asr' },
          { languageCode: 'en-US', kind: 'asr' },    // auto-translated
        ],
        audioTracks: [
          { audioTrackId: 'en-US.10', defaultCaptionTrackIndex: 2 },  // a dub
          { audioTrackId: 'fr-FR.4', defaultCaptionTrackIndex: 2 },   // the original
        ],
        defaultAudioTrackIndex: 1,
      },
    },
  };
  assert.equal(spokenCaptionLanguage(pr), 'fr-FR');
  assert.equal(asrLanguage({ asrLang: spokenCaptionLanguage(pr) }), 'fr');
});

test('a dub the viewer is actually hearing counts as that language, not the original', () => {
  // defaultAudioTrackIndex is what plays. If that is the dub, the dub is what
  // they are listening to, and counting it as the original would be a lie.
  const pr = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ languageCode: 'en', kind: 'asr' }],
        audioTracks: [
          { audioTrackId: 'en-US.4' },    // original
          { audioTrackId: 'fr-FR.10' },   // dubbed
        ],
        defaultAudioTrackIndex: 1,
      },
    },
  };
  assert.equal(asrLanguage({ asrLang: spokenCaptionLanguage(pr) }), 'fr');
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
  // Whatever the audio track id says, asrLanguage has to reduce it to one of
  // the three answers the rest of the extension understands.
  const forAudio = (id) => {
    const pr = multiLanguageShort();
    pr.captions.playerCaptionsTracklistRenderer.audioTracks[1].audioTrackId = id;
    return asrLanguage({ asrLang: spokenCaptionLanguage(pr) });
  };
  assert.equal(forAudio('en-US.4'), 'en');
  assert.equal(forAudio('fr-FR.4'), 'fr');
  assert.equal(forAudio('ja.4'), 'other');
});
