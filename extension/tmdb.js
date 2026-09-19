// TMDB (themoviedb.org) episode-runtime lookups. Used to auto-calculate a
// manually-logged series episode's duration instead of typing minutes by
// hand. Requires a free personal API key (themoviedb.org/settings/api),
// stored per-user in chrome.storage.sync rather than checked into the repo
// like the shared Supabase anon key.

const TMDB_BASE = 'https://api.themoviedb.org/3';

// How far past TMDB's first hit to look for an actual series. Three is
// enough for the real cases (a film and its making-of both outranking the
// show) without turning one lookup into a burst of requests.
const TMDB_CANDIDATES = 3;

async function tmdbGetApiKey() {
  const { tmdbApiKey } = await chrome.storage.sync.get('tmdbApiKey');
  if (tmdbApiKey) return tmdbApiKey;
  // Falls back to the git-ignored config.local.js default, if present —
  // lets a personal key ship without ever being typed into the popup.
  return (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) ? TMDB_API_KEY : null;
}

async function tmdbSetApiKey(key) {
  await chrome.storage.sync.set({ tmdbApiKey: key });
}

// Episode runtimes never change once aired, so lookups are cached forever
// (including misses, as `null`) to avoid re-hitting the API every time the
// same episode is logged.
async function tmdbCacheGet(key) {
  const { tmdbCache = {} } = await chrome.storage.local.get('tmdbCache');
  return tmdbCache[key];
}

async function tmdbCacheSet(key, value) {
  const { tmdbCache = {} } = await chrome.storage.local.get('tmdbCache');
  tmdbCache[key] = value;
  await chrome.storage.local.set({ tmdbCache });
}

// Gimy-style names carry a season suffix (反恐特警組第八季) that would break
// the TMDB search — query without it.
function tmdbSearchName(seriesName) {
  return seriesName.replace(/第[〇一二三四五六七八九十\d]+季/g, '').trim();
}

// Accents, case and punctuation differ freely between what a streaming site
// prints and what TMDB stores ("Les Misérables" / "les miserables"), and
// none of it changes which show is meant.
function tmdbTitleKey(title) {
  return (title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// TMDB orders search hits by popularity, which is not the same as "the show
// you meant": a film adaptation and its making-of both live under /tv too,
// and either can outrank the series itself. Float a hit whose own title is
// what was typed to the front, keeping TMDB's order among equals. Pure, so
// the test suite can pin the ordering without the network.
function tmdbRankShows(results, seriesName) {
  const want = tmdbTitleKey(tmdbSearchName(seriesName));
  return (results || [])
    .map((hit, order) => ({
      hit,
      order,
      exact: tmdbTitleKey(hit.name) === want || tmdbTitleKey(hit.original_name) === want,
    }))
    .sort((a, b) => (b.exact - a.exact) || (a.order - b.order))
    .map(entry => ({ ...entry.hit, exact: entry.exact }));
}

// The top few candidates for a series name, best first. Each is
// { id, poster, lang, exact } (poster = full image URL or null, lang =
// ISO 639-1 original language like 'en'/'fr'/'zh', exact = carries the
// title that was typed), cached forever.
async function tmdbFindShows(seriesName, apiKey) {
  // "v5:" invalidates cache entries from before candidates were ranked and
  // kept as a list (and, further back, before the original language was
  // stored, and before errors stopped being cached as permanent misses) —
  // storage.local survives extension reloads, so stale entries would
  // otherwise stick around forever.
  const cacheKey = `v5:shows:${seriesName.toLowerCase()}`;
  const cached = await tmdbCacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${TMDB_BASE}/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(tmdbSearchName(seriesName))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);
  const data = await res.json();
  const shows = tmdbRankShows(data.results, seriesName)
    .slice(0, TMDB_CANDIDATES)
    .map(hit => ({
      id: hit.id,
      poster: hit.poster_path ? `https://image.tmdb.org/t/p/w92${hit.poster_path}` : null,
      lang: hit.original_language || null,
      exact: hit.exact,
    }));
  await tmdbCacheSet(cacheKey, shows);
  return shows;
}

// Show-level facts, cached forever. `episodes` is what tells a series apart
// from a one-off: TMDB files films and specials under /tv as well, and they
// carry exactly one episode.
async function tmdbShowDetail(showId, apiKey) {
  const cacheKey = `v1:show:${showId}`;
  const cached = await tmdbCacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const res = await fetch(`${TMDB_BASE}/tv/${showId}?api_key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`TMDB show lookup failed (${res.status})`);
  const data = await res.json();
  const detail = {
    episodes: data.number_of_episodes || 0,
    // The show's typical episode length, for episodes that carry no runtime
    // of their own.
    runtime: (data.episode_run_time && data.episode_run_time[0]) || null,
  };
  await tmdbCacheSet(cacheKey, detail);
  return detail;
}

// Which candidates are still in the running, given one of them may carry
// the exact title that was typed. Pure, for the test suite.
function tmdbContenders(shows) {
  const exact = (shows || []).filter(show => show.exact);
  return exact.length ? exact : (shows || []);
}

// The candidate everything else should be about: the first one TMDB knows
// as a real series. Without this a film sharing the show's name hands back
// its own runtime for anything logged as S1E1 — a two-hour "episode" — and
// its poster and language along with it.
//
// Once anything carries the exact title that was typed, only those compete:
// a show with more episodes is never reason enough to answer with a
// different name than the one asked about. And if nothing in the running
// has more than one episode (a series one episode into its first season),
// the best-ranked hit stands.
async function tmdbFindShow(seriesName, apiKey) {
  const shows = await tmdbFindShows(seriesName, apiKey);
  const running = tmdbContenders(shows);
  for (const show of running) {
    const detail = await tmdbShowDetail(show.id, apiKey);
    if (detail.episodes > 1) return show;
  }
  return running[0] || null;
}

// Original language of a series ('fr' | 'en' | other ISO code) or null.
// Never throws — used to skip the manual language pin when TMDB knows.
async function tmdbShowLanguage(seriesName) {
  try {
    const apiKey = await tmdbGetApiKey();
    if (!apiKey || !seriesName) return null;
    const show = await tmdbFindShow(seriesName, apiKey);
    return show ? show.lang : null;
  } catch {
    return null;
  }
}

async function tmdbFindShowId(seriesName, apiKey) {
  const show = await tmdbFindShow(seriesName, apiKey);
  return show ? show.id : null;
}

// Poster URL for a series name, or null (no key / no match / no artwork).
// Never throws — callers use it for decoration only.
async function tmdbShowPoster(seriesName) {
  try {
    const apiKey = await tmdbGetApiKey();
    if (!apiKey || !seriesName) return null;
    const show = await tmdbFindShow(seriesName, apiKey);
    return show ? show.poster : null;
  } catch {
    return null;
  }
}

async function tmdbEpisodeInfo(showId, season, episode, apiKey) {
  const cacheKey = `v2:ep:${showId}:${season}:${episode}`;
  const cached = await tmdbCacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${TMDB_BASE}/tv/${showId}/season/${season}/episode/${episode}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (res.status === 404) {
    await tmdbCacheSet(cacheKey, null); // confirmed: TMDB has no such episode
    return null;
  }
  if (!res.ok) throw new Error(`TMDB episode lookup failed (${res.status})`);

  const data = await res.json();
  let minutes = data.runtime;
  if (!minutes) {
    // Some episodes don't carry their own runtime — fall back to the show's
    // typical episode length.
    try {
      minutes = (await tmdbShowDetail(showId, apiKey)).runtime;
    } catch {
      minutes = null; // the episode title is still worth having
    }
  }
  // A confirmed-empty runtime (200 response, just no data yet) is still
  // worth caching as a miss — it's the failed *requests* above that aren't.
  const info = minutes ? { minutes, title: data.name || '' } : null;
  await tmdbCacheSet(cacheKey, info);
  return info;
}

// Returns { minutes, title } for a series episode, or null if there's no API
// key yet, the inputs are incomplete, or TMDB confirms it has no data for
// this show/episode. Throws on request failures (bad key, network, rate
// limit, …) so the caller can show the real reason instead of a generic
// "not found".
async function tmdbLookupEpisode(seriesName, season, episode) {
  const apiKey = await tmdbGetApiKey();
  if (!apiKey || !seriesName || !season || !episode) return null;
  const showId = await tmdbFindShowId(seriesName.trim(), apiKey);
  if (!showId) return null;
  return await tmdbEpisodeInfo(showId, season, episode, apiKey);
}

// Dependency-free enough to require() the ranking into a Node test.
if (typeof module !== 'undefined') {
  module.exports = { tmdbSearchName, tmdbTitleKey, tmdbRankShows, tmdbContenders };
}
