// Runs in the page's MAIN world so it can read YouTube's player response.
// Extracts video metadata + language signals and hands them to content.js
// via a CustomEvent (detail is JSON — objects don't cross world boundaries).
(() => {
  if (window.__ecouteBridgeLoaded) return; // double-injection guard
  window.__ecouteBridgeLoaded = true;

  function getPlayerResponse() {
    // Regular watch pages use #movie_player; Shorts use #shorts-player.
    for (const id of ['movie_player', 'shorts-player']) {
      const player = document.getElementById(id);
      try {
        if (player && typeof player.getPlayerResponse === 'function') {
          const pr = player.getPlayerResponse();
          if (pr) return pr;
        }
      } catch { /* player not ready */ }
    }
    return window.ytInitialPlayerResponse || null;
  }

  function currentVideoId() {
    const v = new URLSearchParams(location.search).get('v');
    if (v) return v;
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  const FAST_RETRY_MS = 1000;
  const FAST_RETRY_LIMIT = 12; // quick burst right after load (~12s)
  // A freshly-uploaded video can take a long while for YouTube to finish
  // auto-captioning. Once the fast burst finds nothing, keep checking back
  // at a much lower rate for as long as the tab stays on this video, so ASR
  // that shows up later still gets picked up without a page reload.
  const SLOW_POLL_MS = 2 * 60 * 1000;
  const SLOW_POLL_LIMIT = 20; // ~40 more minutes

  let attempts = 0;
  let slowAttempts = 0;
  let timer = null;

  function probe() {
    const urlVideoId = currentVideoId();
    if (!urlVideoId) return;

    const pr = getPlayerResponse();
    const details = pr && pr.videoDetails;
    // Player response can lag behind SPA navigation — retry until it matches the URL.
    if (!details || details.videoId !== urlVideoId) {
      if (++attempts < FAST_RETRY_LIMIT) timer = setTimeout(probe, FAST_RETRY_MS);
      return;
    }

    const tracks =
      (pr.captions &&
        pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    // ASR (auto-generated) captions are always in the spoken language —
    // the strongest signal for what language the audio actually is.
    const asr = tracks.find((t) => t.kind === 'asr');

    const info = {
      videoId: details.videoId,
      title: details.title || '',
      channel: details.author || '',
      channelId: details.channelId || '',
      asrLang: asr ? asr.languageCode : null,
      captionLangs: tracks.filter((t) => t.kind !== 'asr').map((t) => t.languageCode),
      isShort: location.pathname.startsWith('/shorts/'),
    };
    window.dispatchEvent(new CustomEvent('ecoute-videoinfo', { detail: JSON.stringify(info) }));

    if (asr) return; // resolved — nothing left to poll for

    // The caption list can load after the rest of the player response, or
    // not exist yet at all for a brand-new upload. Re-announce when it
    // shows up so a late ASR track still flips the video to tracked.
    if (++attempts < FAST_RETRY_LIMIT) {
      timer = setTimeout(probe, FAST_RETRY_MS);
    } else if (slowAttempts++ < SLOW_POLL_LIMIT) {
      timer = setTimeout(probe, SLOW_POLL_MS);
    }
  }

  function schedule() {
    clearTimeout(timer);
    attempts = 0;
    slowAttempts = 0;
    timer = setTimeout(probe, 800);
  }

  window.addEventListener('yt-navigate-finish', schedule);
  schedule();
})();
