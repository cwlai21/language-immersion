// Which language a YouTube video is actually spoken in, read out of the
// player response's caption/audio track list. Pure and dependency-free so
// page-bridge.js can use it in the page's MAIN world and the Node tests can
// require() it.
//
// This used to be one line in the bridge — "the first track with kind 'asr'"
// — because a video had exactly one auto-generated caption track and it was
// always in the spoken language. YouTube now auto-generates captions in ~20
// languages for a single video and marks every one of them kind:"asr", in an
// order that means nothing: an English tennis short lists Japanese first. The
// old rule read that as "captioned in a language we don't track" and silently
// refused to count the video.

// Returns an ISO code like 'en', 'fr-FR', 'ja' — or null when the video has
// no auto-captions at all (a brand-new upload YouTube hasn't reached yet).
function spokenCaptionLanguage(playerResponse) {
  const renderer =
    (playerResponse &&
      playerResponse.captions &&
      playerResponse.captions.playerCaptionsTracklistRenderer) || {};
  const tracks = renderer.captionTracks || [];
  const audioTracks = renderer.audioTracks || [];

  // The audio settles it. Each audio track names the caption track that goes
  // with it, and the default audio track is the one the video plays in —
  // index 1 of 21 on that tennis short, "en-US.4", pointing at caption track
  // 11, "en". A dub the viewer selects by hand is not reflected here; the
  // default is what plays unless they go looking.
  const audio = audioTracks[renderer.defaultAudioTrackIndex];
  if (audio) {
    const paired = tracks[audio.defaultCaptionTrackIndex];
    if (paired && paired.languageCode) return paired.languageCode;
    // No usable pairing — the track id carries the language itself.
    const id = audio.audioTrackId || '';
    if (id) return id.split('.')[0] || null;
  }

  // One auto-caption track and no audio track list: the ordinary video, and
  // what every video looked like before multi-language auto-captions.
  const asr = tracks.find((t) => t.kind === 'asr');
  return asr && asr.languageCode ? asr.languageCode : null;
}

if (typeof module !== 'undefined') {
  module.exports = { spokenCaptionLanguage };
}
