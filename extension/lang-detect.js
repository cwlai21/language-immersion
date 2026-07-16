// Shared heuristic: guesses spoken language from a video's title. Used as a
// last-resort signal when no ASR captions exist yet — e.g. a video uploaded
// minutes ago, before YouTube finishes auto-captioning it. Deliberately
// conservative: returns null (no guess) rather than a wrong guess when the
// title doesn't clearly lean one way. Loaded by both background.js
// (importScripts) and popup.js (<script>), so keep it dependency-free.
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
