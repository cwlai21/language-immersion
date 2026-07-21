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

if (typeof module !== 'undefined') {
  module.exports = { seriesChanged };
}
