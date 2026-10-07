/* The listening-checklist engine, shared by every trip page (todo.js for the
 * south of France, singapore.js for Singapore). A page supplies its own
 * curated sections and its own storage key; everything below — ticking,
 * cross-device sync, mirroring to the other lists, progress, rendering — is
 * the same for all of them.
 *
 * Item schema, which the pages' data must follow:
 *
 *   id      stable, unique across the page; the storage key for its tick, so
 *           renaming one forgets that it was ticked
 *   lang    'fr' | 'en' — only the flag shown; tracking language is decided
 *           by the extension from the video itself
 *   kind    '▶️' video | '🎙️' podcast | '📖' reading
 *   sec     a real measured length, where the item is one specific video or
 *           episode. `approx` instead is the median of a show's last 40
 *           episodes, shown as "≈35 min" because that is the honest precision.
 *           Neither, where there is nothing to measure (a search link) or no
 *           published durations to read.
 *   url     YouTube watch link (its video id is what watch-sync matches on),
 *           a podcast link, or a search — a search has nothing to match and
 *           stays hand-ticked, which is fine for "go and find something here"
 *   show    a podcast's show name, matched against a session's channel
 *   from    this item came out of the search row with that id, and is drawn
 *           nested under it
 *
 * Ticks sync across devices through one kv_state row per page, and are shared
 * with the extension's other lists through watch-sync.js: ticking here ticks
 * the same content on the dashboard and in À regarder, and the other way
 * about.
 */

function initChecklist({ sections, kvKey, surface }) {
  const SECTIONS = sections;
  const KV_KEY = kvKey;
  const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);
  let checked = {};

  async function loadChecked() {
    try {
      const rows = await sbRequest(`kv_state?key=eq.${KV_KEY}&select=value`);
      if (rows.length) checked = JSON.parse(rows[0].value);
    } catch {
      try { checked = JSON.parse(localStorage.getItem(KV_KEY)) || {}; } catch { checked = {}; }
    }
  }

  async function saveChecked() {
    localStorage.setItem(KV_KEY, JSON.stringify(checked));
    try {
      await sbRequest('kv_state?on_conflict=key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: { key: KV_KEY, value: JSON.stringify(checked), updated_at: new Date().toISOString() },
      });
    } catch { /* offline — localStorage keeps it until next save */ }
  }



  // This page as a surface for watch-sync: keyed by the item's own id, and only
  // items that name something a session could have recorded ever match.
  registerSurface({
    name: surface,
    kv: KV_KEY,
    keys(link) {
      const videoIds = new Set(link.videoIds);
      const shows = new Set(link.shows);
      return ALL_ITEMS.filter((item) => {
        const l = contentLinks(item);
        return l.videoIds.some((v) => videoIds.has(v)) || l.shows.some((sh) => shows.has(sh));
      }).map((item) => item.id);
    },
    patch(state, keys, done) {
      const next = { ...state };
      let changed = false;
      for (const k of keys) {
        if (!!next[k] !== done) { next[k] = done; changed = true; }
      }
      return changed ? next : null;
    },
  });

  // Catch up with the other lists, in both directions.
  //
  // Pulling: ticks made elsewhere while this page wasn't open. Only items we
  // have no answer for are filled in — an item the user deliberately cleared is
  // stored as false, not missing, so it stays cleared.
  //
  // Pushing: a tick of ours the other lists never heard about. mirrorTick
  // matches an item to its sessions by video id, so ticking something off
  // before its session exists mirrors to nothing at all — and a video ticked
  // while still watching it is the normal case, not an edge one: the session
  // is only written once playback has been idle for 90 seconds. "Lighting the
  // F1 Singapore Grand Prix" was ticked fourteen seconds before its session
  // landed, so the dashboard went on showing it unwatched.
  //
  // A tick of ours that the others don't know about can only be a mirror that
  // didn't happen. Unticking anywhere mirrors too, so a box cleared on the
  // dashboard would have cleared ours as well, rather than leaving us done.
  async function reconcile() {
    const done = await doneElsewhere(ALL_ITEMS);

    const missing = [...done].filter((id) => checked[id] === undefined);
    if (missing.length) {
      for (const id of missing) checked[id] = true;
      render();
      await saveChecked();
    }

    const unheard = ALL_ITEMS.filter((item) => checked[item.id] && !done.has(item.id));
    let stillUnheard = false;
    for (const item of unheard) {
      if (!matchable(item)) continue; // a search link has nothing to mirror onto, ever
      const reached = await mirrorTick(surface, contentLinks(item), true);
      if (!reached) stillUnheard = true;
    }
    if (stillUnheard) scheduleMirrorRetry();
  }

  // A tick whose content has no session yet reaches nothing, and reconcile()
  // would only repair it the next time this page is opened — by which time the
  // dashboard has been showing it unwatched for however long. The session
  // normally lands a minute or two after the tick (90 seconds of idle playback
  // writes it), so a page left open can simply ask again.
  //
  // Bounded on purpose: a handful of attempts, and only while something is
  // actually outstanding. An item with nothing to match on — a search link —
  // never schedules one, because no amount of asking will resolve it.
  const RETRY_MS = 2 * 60 * 1000;
  const RETRY_LIMIT = 5;
  let retryTimer = null;
  let retriesLeft = RETRY_LIMIT;

  function scheduleMirrorRetry() {
    if (retryTimer || retriesLeft <= 0) return;
    retriesLeft -= 1;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      await reconcile();
    }, RETRY_MS);
  }

  function matchable(item) {
    const link = contentLinks(item);
    return link.videoIds.length > 0 || link.shows.length > 0;
  }

  function updateProgress() {
    const total = SECTIONS.reduce((n, s) => n + s.items.length, 0);
    const done = SECTIONS.reduce((n, s) => n + s.items.filter((i) => checked[i.id]).length, 0);
    document.getElementById('progress').textContent = `${done} / ${total} ✓`;
  }

  function render() {
    const root = document.getElementById('sections');
    root.innerHTML = '';
    for (const section of SECTIONS) {
      const div = document.createElement('div');
      div.className = 'trip-section';
      div.innerHTML = `<h2>${section.title}</h2><p class="blurb">${section.blurb}</p>`;
      for (const item of section.items) {
        const row = document.createElement('div');
        // A pick (`from`) is drawn as a child of the search row it came out of —
        // side by side they read as unrelated entries, which is what the flat
        // list looked like the first time round.
        row.className = 'trip-item' + (item.from ? ' trip-sub' : '') + (checked[item.id] ? ' done' : '');

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!checked[item.id];
        box.onchange = () => {
          // Unticking records false rather than dropping the key: reconcile()
          // fills in only the items it has no answer for, and "I cleared this on
          // purpose" is an answer.
          checked[item.id] = box.checked;
          row.classList.toggle('done', box.checked);
          updateProgress();
          saveChecked();
          // Tick it on the dashboard and in À regarder too, where this item is
          // something they know about. Not awaited: the tick above is already
          // saved, and the mirror is best-effort — but a mirror that reached
          // nothing is worth asking about again, because the usual reason is
          // that the session is still a minute or two from being written.
          mirrorTick(surface, contentLinks(item), box.checked).then((reached) => {
            if (!reached && matchable(item)) scheduleMirrorRetry();
          });
        };

        const info = document.createElement('div');
        info.style.flex = '1';
        info.innerHTML =
          `<div class="trip-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title} ↗</a></div>` +
          `<div class="trip-desc">${item.desc}</div>`;

        const tags = document.createElement('span');
        tags.className = 'trip-tags';
        // formatDuration comes from youtube-todo-rules.js, the same one À
        // regarder uses, so a length reads identically on both pages. Items
        // without a measured length just show the flag and kind.
        // A measured length where there is one thing to time; otherwise a
        // typical episode length, marked "≈" so the two are never confused.
        const dur = formatDuration(item.sec) || approxLength(item.approx);
        tags.textContent = [`${item.lang === 'fr' ? '🇫🇷' : '🇬🇧'} ${item.kind}`, dur]
          .filter(Boolean).join(' · ');

        row.append(box, info, tags);
        div.appendChild(row);
      }
      root.appendChild(div);
    }
    updateProgress();
  }

  (async function init() {
    await loadChecked();
    render();
    reconcile(); // network round-trip — let the list paint first
  })();
}
