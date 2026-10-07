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

  // The audio settles it, and the track id is how it says so: the default
  // audio track is the one the video plays in, and its id is "fr-FR.4",
  // "en-US.10", "ja.10" — language first.
  //
  // Each audio track also names a caption track to show alongside it, and
  // reading *that* was the first attempt. It is not the same claim, and the
  // two can disagree: on L'Overcut's Singapore circuit preview — French
  // title, French audio, French captions written by hand — the default audio
  // track is "fr-FR.4" and the caption track it points at is the English
  // auto-translation, so the video was announced as English. What a viewer is
  // offered to read is a presentation choice; what the audio is in is a fact.
  const audio = audioTracks[renderer.defaultAudioTrackIndex];
  if (audio) {
    const spoken = (audio.audioTrackId || '').split('.')[0];
    if (spoken) return spoken;
    // No id to read — the caption it pairs with is the next best guess.
    const paired = tracks[audio.defaultCaptionTrackIndex];
    if (paired && paired.languageCode) return paired.languageCode;
  }

  // One auto-caption track and no audio track list: the ordinary video, and
  // what every video looked like before multi-language auto-captions.
  const asr = tracks.find((t) => t.kind === 'asr');
  return asr && asr.languageCode ? asr.languageCode : null;
}

if (typeof module !== 'undefined') {
  module.exports = { spokenCaptionLanguage };
}
