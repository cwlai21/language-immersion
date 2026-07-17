// TMDB (themoviedb.org) episode-runtime lookups. Used to auto-calculate a
// manually-logged series episode's duration instead of typing minutes by
// hand. Requires a free personal API key (themoviedb.org/settings/api),
// stored per-user in chrome.storage.sync rather than checked into the repo
// like the shared Supabase anon key.

const TMDB_BASE = 'https://api.themoviedb.org/3';

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

// Returns { id, poster } (poster = full image URL or null), cached forever.
async function tmdbFindShow(seriesName, apiKey) {
  // "v3:" invalidates cache entries from before errors stopped being cached
  // as permanent misses and before posters were stored — storage.local
  // survives extension reloads, so stale entries would otherwise block a
  // show forever.
  const cacheKey = `v3:show:${seriesName.toLowerCase()}`;
  const cached = await tmdbCacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${TMDB_BASE}/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(tmdbSearchName(seriesName))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);
  const data = await res.json();
  const hit = data.results && data.results[0];
  const info = hit
    ? { id: hit.id, poster: hit.poster_path ? `https://image.tmdb.org/t/p/w92${hit.poster_path}` : null }
    : null;
  await tmdbCacheSet(cacheKey, info);
  return info;
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
    const showRes = await fetch(`${TMDB_BASE}/tv/${showId}?api_key=${encodeURIComponent(apiKey)}`);
    if (showRes.ok) {
      const showData = await showRes.json();
      minutes = (showData.episode_run_time && showData.episode_run_time[0]) || null;
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
