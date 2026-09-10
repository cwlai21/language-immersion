// Shared language heuristics: what language a YouTube video's audio is in, and
// whether it counts at all. Loaded by background.js (importScripts), popup.js
// (<script>), and the Node test suite — so keep it dependency-free: no DOM, no
// chrome.*, no network.

// Scripts that never appear in the title of a video whose audio is French or
// English. Their presence is a veto, not a guess: see trackDecision.
const NON_LATIN_SCRIPT = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function hasNonLatinScript(text) {
  return NON_LATIN_SCRIPT.test(text || '');
}

// Guesses spoken language from a video's title. Used as a last-resort signal
// when no ASR captions exist yet — e.g. a video uploaded minutes ago, before
// YouTube finishes auto-captioning it. Deliberately conservative: returns null
// (no guess) rather than a wrong guess when the title doesn't clearly lean one
// way.
function guessLangFromTitle(title) {
  if (!title) return null;
  const t = title.toLowerCase();

  // Diacritics that only occur in French are a strong standalone signal.
  if (/[àâçèéêëîïôùûüœæ]/.test(t)) return 'fr';

  const frWords = (t.match(/\b(le|la|les|des|une|un|du|de|et|est|pour|avec|dans|sur|qui|que|au|aux|ce|cette|ces|comment|pourquoi|face|vrai|vraie|vrais|vraies|nous|vous|notre|votre|leur|mon|ma|mes|son|sa|ses)\b/g) || []).length;
  const enWords = (t.match(/\b(the|and|is|for|with|in|on|that|which|how|why|your|what|this|these|those|from|about|when|where|you|are|will|can)\b/g) || []).length;

  if (frWords > enWords && frWords >= 2) return 'fr';
  if (enWords > frWords && enWords >= 2) return 'en';
  return null;
}

// What YouTube's auto-generated captions say the audio is:
//   'fr' | 'en'  a language we track
//   'other'      a language we don't — evidence about the video, not absence of it
//   null         no ASR track at all, so nothing is known yet
// The last two used to be the same answer, which meant a video with Chinese
// captions was treated as un-captioned and fell through to a title guess.
function asrLanguage(video) {
  const asr = ((video && video.asrLang) || '').toLowerCase();
  if (!asr) return null;
  if (asr.startsWith('fr')) return 'fr';
  if (asr.startsWith('en')) return 'en';
  return 'other';
}

// Returns { lang: 'fr'|'en', reason: 'override'|'channel'|'asr'|'title' } or
// null for "don't track this".
function trackDecision(video, overrides, trackedChannels) {
  const ov = (overrides || {})[video.videoId];
  if (ov !== undefined) return ov ? { lang: ov, reason: 'override' } : null;

  // A pinned channel is your own answer and outranks everything below,
  // including the veto — that is how a channel with a Chinese name but
  // genuinely English audio keeps counting.
  const ch = (trackedChannels || []).find((c) => c.id === video.channelId);
  if (ch) return { lang: ch.lang, reason: 'channel' };

  const asr = asrLanguage(video);

  // French captions are a deliberate detection, so they carry regardless of
  // the title's script — that is what keeps a French video on a Taiwanese
  // distributor's channel ("Marius Fabre 法鉑馬賽肥皂 – 家族故事") tracked.
  if (asr === 'fr') return { lang: 'fr', reason: 'asr' };

  if (asr === 'other') return null; // captioned, just not in a language we track

  // English is where YouTube's captioner lands when it cannot tell, which is
  // how a Mandarin video ends up with a single caption track reading
  // languageCode "en" — 皮卡邱I 网球发球慢动作 has exactly that. So an English
  // label doesn't survive a title in another script, and neither does a guess
  // from such a title. Only English: YouTube never falls back to French.
  const foreignScript = hasNonLatinScript(video.title) || hasNonLatinScript(video.channel);
  if (asr === 'en') return foreignScript ? null : { lang: 'en', reason: 'asr' };
  if (foreignScript) return null;

  // No captions at all yet — e.g. a video too new for YouTube to have got to.
  // Fall back to a title guess until the periodic re-probe (page-bridge.js)
  // finds real captions and this session's language self-corrects.
  const hint = guessLangFromTitle(video.title);
  if (hint) return { lang: hint, reason: 'title' };
  return null;
}

// Dual browser/Node, like rules.js: importScripts/<script> define these as
// globals; require() in the tests gets them through module.exports.
if (typeof module !== 'undefined') {
  module.exports = { guessLangFromTitle, hasNonLatinScript, asrLanguage, trackDecision };
}
