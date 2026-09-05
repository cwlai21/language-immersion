/* Keeps the checkboxes for the same piece of content in step across the
 * extension's several lists — "À regarder" (kv_state `video-todo`, keyed by
 * videoId), the dashboard's session list (`watch-todo`, keyed by watchKey),
 * and any curated page that opts in, such as ✈️ Voyage (`trip-checklist`,
 * keyed by the item's own id). Ticking a thing anywhere ticks it everywhere,
 * so a finished video is confirmed once, not once per list.
 *
 * Each list is a "surface": a kv_state document, the keys it uses, and how to
 * write a done/undone into it. Two are built in here; a page registers its own
 * with registerSurface() when it loads. The surfaces never learn about each
 * other — they are matched through what a session records about the content
 * itself (video_id, and channel for a podcast), which is the one thing every
 * list can name.
 *
 * That gives a page two halves, and it needs both:
 *
 *   mirrorTick()    push — when the user ticks here, tell every surface that
 *                   is loaded on this page.
 *   doneElsewhere() pull — when the page opens, catch up on ticks made while
 *                   it wasn't loaded, for items it has no answer for yet.
 *
 * Loaded as a <script> tag after rules.js (watchKey, contentLinks) and
 * supabase.js (sbRequest). Every step tolerates being offline: a failed mirror
 * leaves the other lists alone rather than throwing at the click that
 * triggered it. The tick the user actually made is already saved by its own
 * page. Tolerated is not the same as silent, though: anything that actually
 * fails says so on the console under [watch-sync], because a mirror that
 * quietly does nothing is indistinguishable from one that isn't loaded at
 * all. Only failures — the ordinary "nothing to mirror here" cases are the
 * common ones and would drown them out. */

// console.log, not .debug: Chrome hides debug-level output unless the console
// is set to Verbose, and a diagnostic nobody sees is no diagnostic.
const log = (...args) => console.log('[watch-sync]', ...args);

const WATCHLIST_KV = 'video-todo';
const WATCH_TODO_KV = 'watch-todo';

/* ── kv_state ─────────────────────────────── */

// Read a kv_state row, apply `mutate`, write it back. Re-reading first means a
// mirror never clobbers a change the other device made meanwhile. `mutate`
// returning null means "nothing to do" and skips the write.
async function kvUpdate(key, mutate) {
  let current = {};
  try {
    const rows = await sbRequest(`kv_state?key=eq.${key}&select=value`);
    if (rows.length) current = JSON.parse(rows[0].value);
  } catch (e) {
    log('could not read', key, '— leaving it as it was:', e);
    return null;
  }
  const next = mutate(current);
  if (!next) return null; // nothing to change in this list
  try {
    await sbRequest('kv_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: { key, value: JSON.stringify(next), updated_at: new Date().toISOString() },
    });
  } catch (e) {
    log('could not write', key + ':', e);
    return null;
  }
  return next;
}

async function kvRead(key) {
  try {
    const rows = await sbRequest(`kv_state?key=eq.${key}&select=value`);
    return rows.length ? JSON.parse(rows[0].value) : {};
  } catch (e) {
    log('could not read', key + ':', e);
    return {};
  }
}

/* ── Surfaces ─────────────────────────────── */

// A surface is one checkbox list: { name, kv, keys(link), patch(state, keys,
// done) }. `keys` turns a resolved link into that list's own keys; `patch`
// returns the next kv document, or null when there is nothing to change.
const SURFACES = [];

function registerSurface(surface) {
  if (!SURFACES.some((s) => s.name === surface.name)) SURFACES.push(surface);
}

// À regarder. Only ever updates videos already on the list: one watched
// without ever being saved to the playlist is skipped, not invented as a new
// entry.
registerSurface({
  name: 'watchlist',
  kv: WATCHLIST_KV,
  keys: (link) => link.videoIds,
  patch(state, keys, done) {
    const next = { ...state };
    let changed = false;
    for (const id of keys) {
      if (next[id] && !!next[id].done !== done) {
        // withDoneAt, so a video ticked from another page carries the same
        // finished-at stamp the watchlist's own checkbox would have given it.
        next[id] = withDoneAt(next[id], done);
        changed = true;
      }
    }
    return changed ? next : null;
  },
});

// The dashboard's session list. A video with no sessions yet has no key here,
// which is nothing to mirror rather than an error.
registerSurface({
  name: 'sessions',
  kv: WATCH_TODO_KV,
  keys: (link) => sessionWatchKeys(link.rows),
  patch(state, keys, done) {
    if (!keys.length) return null;
    const next = { ...state };
    for (const k of keys) next[k] = done ? 'done' : 'todo';
    return next;
  },
});

/* ── Resolving what was ticked ────────────── */

// The session rows a set of video ids and podcast shows refers to. Video ids
// are matched in the query; shows are matched here, because `channel` is
// whatever Spotify or Apple called the show and only normShow() can see past
// the accents and capitals.
async function resolveLink({ videoIds = [], shows = [] }) {
  const ids = [...new Set(videoIds.filter(Boolean))];
  const wanted = new Set(shows.map(normShow).filter(Boolean));
  const cols = 'select=title,channel,type,language,season,episode,video_id';
  const rows = [];

  if (ids.length) {
    try {
      const list = ids.map((id) => `"${id}"`).join(',');
      rows.push(...await sbRequest(`listening_sessions?${cols}&video_id=in.(${encodeURIComponent(list)})`));
    } catch (e) { log('session lookup by video id failed:', e); }
  }
  if (wanted.size) {
    try {
      const pods = await sbRequest(`listening_sessions?${cols}&type=eq.podcast`);
      rows.push(...pods.filter((r) => wanted.has(normShow(r.channel))));
    } catch (e) { log('podcast lookup failed:', e); }
  }
  return { videoIds: ids, shows: [...wanted], rows };
}

/* ── Push: the user ticked something here ─── */

// Tell every other surface loaded on this page. Callers deliberately don't
// await it: the tick that triggered it is already saved by its own page, and a
// mirror that fails is a mirror that simply didn't happen.
async function mirrorTick(origin, spec, done) {
  const targets = SURFACES.filter((s) => s.name !== origin);
  if (!targets.length) return;
  const link = await resolveLink(spec);
  // Nothing to match on: a search link, or a video with no sessions and not on
  // the playlist. Ordinary, not a failure.
  if (!link.videoIds.length && !link.rows.length) return;
  for (const surface of targets) {
    const keys = surface.keys(link);
    if (keys.length) await kvUpdate(surface.kv, (state) => surface.patch(state, keys, done));
  }
}

/* ── Pull: catching up on what happened elsewhere ── */

// Which of a page's items the other lists already consider done. `items` are
// the page's own — each with an `id` and whatever it can be matched by (`url`
// for a video, `show` for a podcast). A page calls this on load and fills in
// only the items it has no answer for, so a box the user deliberately cleared
// stays clear.
async function doneElsewhere(items) {
  const links = (items || []).map(contentLinks);
  const spec = {
    videoIds: links.flatMap((l) => l.videoIds),
    shows: links.flatMap((l) => l.shows),
  };
  if (!spec.videoIds.length && !spec.shows.length) return new Set();
  const [link, watchlist, watchTodo] = await Promise.all([
    resolveLink(spec),
    kvRead(WATCHLIST_KV),
    kvRead(WATCH_TODO_KV),
  ]);
  return doneItemIds(items, link.rows, watchlist, watchTodo);
}
