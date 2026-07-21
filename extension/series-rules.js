// Pure decision logic for series-episode identity, shared by background.js
// (importScripts) and its Node test suite (test/series-rules.test.js via
// require()). Dependency-free like lang-detect.js.

// Did onSeriesHeartbeat's episode/show identity actually change, or did the
// page's metadata extraction just have a flaky read this beat?
//
// A missing (null) episode reading is never itself evidence of a change —
// streaming sites' DOM is flaky (ad overlays, re-renders) and can briefly
// fail to parse the episode number even mid-episode. Treating that as
// "episode changed" used to finalize-and-restart the seconds accumulator on
// every flaky read, fragmenting one long viewing session into dozens of
// under-a-minute rows — and silently dropping any fragment that landed
// under MIN_SESSION_SECONDS. A name mismatch is trusted immediately (it's
// never null, since callers only reach here once meta.name is truthy); an
// episode mismatch only counts once the new reading is non-null.
function seriesChanged(currentSeries, meta) {
  if (!currentSeries) return false;
  if (currentSeries.name !== meta.name) return true;
  return meta.episode != null && currentSeries.episode !== meta.episode;
}

// Apply one heartbeat to the per-tab series-tracking state. Pure — returns
// { seriesByTab, finalized } and never mutates the input map. `finalized`
// is the series entry that just ended (the caller decides whether/how to
// persist it, e.g. via finalizeSeries), or null if nothing ended this beat.
//
// State is keyed by tabId so two series tabs open at once (even if one
// just sits paused, still sending its own 15s heartbeats) never interfere
// with each other. A single global slot was the root cause of a real bug:
// sessions like "傳奇辦公室" and "校園之外第一季", open in different tabs,
// kept finalizing into one another every heartbeat, fragmenting real
// viewing into dozens of sub-minute rows.
function applySeriesHeartbeat(seriesByTab, tabId, meta, seconds, now, date) {
  const state = { ...seriesByTab };
  let currentSeries = state[tabId] || null;
  let finalized = null;

  if (meta && meta.name) {
    if (seriesChanged(currentSeries, meta)) {
      finalized = currentSeries;
      currentSeries = null;
    }
    currentSeries = currentSeries
      ? {
          ...currentSeries,
          // Metadata can trickle in after playback starts (Netflix's title
          // bar only exists once the controls have been shown) — enrich
          // rather than overwrite with a still-missing value.
          season: meta.season != null ? meta.season : currentSeries.season,
          epTitle: meta.epTitle || currentSeries.epTitle,
        }
      : {
          tabId,
          site: meta.site,
          name: meta.name,
          season: meta.season,
          episode: meta.episode,
          epTitle: meta.epTitle || '',
          date,
          seconds: 0,
          startedAt: now,
        };
  }

  // Seconds arrive from whichever frame owns the <video> (Gimy's player is
  // an iframe), which may not be the frame that sent the metadata — both
  // frames belong to this same tab, so either can contribute seconds.
  if (currentSeries && seconds > 0) {
    currentSeries = { ...currentSeries, seconds: currentSeries.seconds + seconds, lastBeat: now };
  }

  if (currentSeries) state[tabId] = currentSeries;
  else delete state[tabId];

  return { seriesByTab: state, finalized };
}

if (typeof module !== 'undefined') {
  module.exports = { seriesChanged, applySeriesHeartbeat };
}
