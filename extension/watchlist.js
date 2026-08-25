/* "À regarder" — videos pulled from the YouTube "français" playlist by the
 * background poller (see background.js), stored in the shared kv_state row so
 * the list follows you across machines. Items:
 *   video-todo = { [videoId]: { videoId, title, channel, lang, addedAt, done } }
 * This page only displays and edits the list; the background worker owns
 * filling it and removing videos from the playlist. */

const KV_KEY = 'video-todo';
let todo = {};

async function loadTodo() {
  try {
    const rows = await sbRequest(`kv_state?key=eq.${KV_KEY}&select=value`);
    todo = rows.length ? JSON.parse(rows[0].value) : {};
  } catch {
    try { todo = JSON.parse(localStorage.getItem(KV_KEY)) || {}; } catch { todo = {}; }
  }
}

// Read the latest server copy, apply `mutate`, write it back — so a checkbox
// here doesn't clobber videos the poller added on another device meanwhile.
async function saveTodo(mutate) {
  let latest = { ...todo };
  try {
    const rows = await sbRequest(`kv_state?key=eq.${KV_KEY}&select=value`);
    if (rows.length) latest = JSON.parse(rows[0].value);
  } catch { /* offline — fall back to the in-memory copy */ }
  todo = mutate(latest);
  localStorage.setItem(KV_KEY, JSON.stringify(todo));
  try {
    await sbRequest('kv_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: { key: KV_KEY, value: JSON.stringify(todo), updated_at: new Date().toISOString() },
    });
  } catch { /* offline — localStorage keeps it until the next save */ }
}

function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  // Watched videos import pre-ticked, and their addedAt is "now", so a plain
  // newest-first sort would pile them on top of what you actually still want
  // to watch. Unwatched first, newest-first within each half.
  const items = Object.values(todo).sort(
    (a, b) => (!!a.done - !!b.done) || (b.addedAt || 0) - (a.addedAt || 0),
  );
  const doneCount = items.filter((i) => i.done).length;
  document.getElementById('count').textContent =
    items.length ? `${items.length - doneCount} à regarder · ${items.length} en tout` : '';
  document.getElementById('clearDone').hidden = doneCount === 0;

  if (!items.length) {
    list.innerHTML = '<p class="wl-empty">Rien pour l\'instant — enregistre une vidéo dans ta playlist « français » et elle apparaîtra ici. 🎬</p>';
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'wl-item' + (item.done ? ' done' : '');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!item.done;
    box.onchange = () => {
      const done = box.checked;
      row.classList.toggle('done', done);
      item.done = done; // optimistic
      saveTodo((latest) => {
        if (latest[item.videoId]) latest[item.videoId].done = done;
        return latest;
      }).then(render);
    };

    const info = document.createElement('div');
    info.style.flex = '1';
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`;
    const title = document.createElement('div');
    title.className = 'wl-title';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `${item.title || '(sans titre)'} ↗`;
    title.appendChild(link);
    const meta = document.createElement('div');
    meta.className = 'wl-meta';
    // formatDuration comes from youtube-todo-rules.js. Unknown lengths (older
    // imports not yet backfilled, live streams) just show the channel alone.
    const dur = formatDuration(item.durationSec);
    meta.textContent = [item.channel || '', dur].filter(Boolean).join(' · ');
    info.append(title, meta);

    const flag = document.createElement('span');
    flag.className = 'wl-flag';
    flag.textContent = item.lang === 'en' ? '🇬🇧' : '🇫🇷';

    const del = document.createElement('button');
    del.className = 'wl-del';
    del.textContent = '✕';
    del.title = 'Retirer de la liste';
    del.onclick = () => {
      delete todo[item.videoId]; // optimistic
      saveTodo((latest) => { delete latest[item.videoId]; return latest; }).then(render);
    };

    row.append(box, info, flag, del);
    list.appendChild(row);
  }
}

document.getElementById('clearDone').addEventListener('click', () => {
  saveTodo((latest) => {
    for (const id of Object.keys(latest)) if (latest[id].done) delete latest[id];
    return latest;
  }).then(render);
});

/* ── Playlist connect / sync (talks to the background worker, which owns
 * the OAuth token and the YouTube API calls). Several playlists are supported,
 * each with its own language tag. ── */
const syncMsg = document.getElementById('syncMsg');
const playlistsEl = document.getElementById('playlists');
const connectBtn = document.getElementById('connectBtn');
const syncBtn = document.getElementById('syncBtn');

// The OAuth connect/sync runs in the extension's background worker, so it only
// works when this page is opened *from the extension* (chrome-extension://…),
// not the GitHub Pages / web copy where chrome.runtime doesn't exist.
const IN_EXTENSION = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

function fmtAgo(ts) {
  if (!ts) return 'jamais';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.round(m / 60)} h`;
}

function addPlaylistRow(url = '', lang = 'fr') {
  const row = document.createElement('div');
  row.className = 'wl-pl-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = 'https://www.youtube.com/playlist?list=…';
  input.value = url;

  const sel = document.createElement('select');
  sel.className = 'input';
  for (const [code, label] of [['fr', '🇫🇷'], ['en', '🇬🇧']]) {
    const opt = document.createElement('option');
    opt.value = code; opt.textContent = label; sel.appendChild(opt);
  }
  sel.value = lang === 'en' ? 'en' : 'fr';

  const del = document.createElement('button');
  del.className = 'wl-pl-del';
  del.textContent = '✕';
  del.title = 'Retirer cette playlist';
  del.onclick = () => { row.remove(); if (!playlistsEl.children.length) addPlaylistRow(); };

  row.append(input, sel, del);
  playlistsEl.appendChild(row);
}

// [{ url, lang }] from the visible rows (skips blank ones).
function gatherPlaylists() {
  return [...playlistsEl.querySelectorAll('.wl-pl-row')]
    .map((r) => ({ url: r.querySelector('input').value.trim(), lang: r.querySelector('select').value }))
    .filter((p) => p.url);
}

async function refreshStatus() {
  if (!IN_EXTENSION) {
    document.getElementById('setupStatus').textContent = '';
    connectBtn.disabled = true;
    syncBtn.hidden = true;
    if (!playlistsEl.children.length) addPlaylistRow();
    syncMsg.textContent = 'ℹ️ Ouvre cette page depuis l\'extension (icône Écoute → Dashboard → À regarder) pour connecter YouTube. Ici, seule la liste s\'affiche.';
    return;
  }
  let st;
  try { st = await chrome.runtime.sendMessage({ type: 'yt-todo-status' }); } catch { return; }
  if (!st) return;
  // Populate rows from the stored playlists (only if the user hasn't started editing).
  if (!playlistsEl.children.length) {
    const pls = (st.playlists || []);
    if (pls.length) for (const p of pls) addPlaylistRow(`https://www.youtube.com/playlist?list=${p.id}`, p.lang);
    else addPlaylistRow();
  }
  // Show the running build: a service worker that didn't pick up a code change
  // is invisible otherwise, and the symptom (nothing syncs) looks like a bug.
  const version = chrome.runtime.getManifest().version;
  document.getElementById('setupStatus').textContent =
    (st.connected ? '✅ connecté' : '') + ` · v${version}`;
  syncBtn.hidden = !st.connected;
  connectBtn.textContent = st.connected ? '🔗 Reconnecter' : '🔗 Connecter & synchroniser';
  if (st.connected && st.lastSync) syncMsg.textContent = `Dernière synchro ${fmtAgo(st.lastSync)}.`;
}

async function runSync(kind) {
  if (!IN_EXTENSION) {
    syncMsg.textContent = '⚠ Ouvre cette page depuis l\'extension pour connecter YouTube.';
    return;
  }
  const playlists = gatherPlaylists();
  if (!playlists.length) { syncMsg.textContent = '⚠ Ajoute d\'abord au moins une playlist.'; return; }
  syncMsg.textContent = '⏳ Synchronisation…';
  connectBtn.disabled = syncBtn.disabled = true;
  let res;
  try {
    await chrome.runtime.sendMessage({ type: 'yt-todo-set-playlists', playlists });
    res = await chrome.runtime.sendMessage({ type: kind });
  } catch (e) {
    // e.g. "Could not establish connection" = the service worker isn't running
    // the new code (reload the extension), or it crashed on load.
    res = { ok: false, reason: String(e && e.message ? e.message : e) };
  }
  connectBtn.disabled = syncBtn.disabled = false;
  if (res && res.ok) {
    const failNote = res.failed ? ` (${res.failed} playlist(s) illisible(s))` : '';
    syncMsg.textContent = `✅ ${res.added} ajoutée(s), ${res.removed} retirée(s)${failNote}.`;
    await loadTodo();
    render();
  } else {
    const reason = res && res.reason;
    syncMsg.textContent = reason === 'no-auth'
      ? '⚠ Connexion YouTube refusée ou annulée.'
      : reason === 'no-playlist'
        ? '⚠ Aucune playlist valide.'
        : `⚠ Échec de la synchro${reason ? ' : ' + reason : ''}.`;
  }
  await refreshStatus();
}

document.getElementById('addPlaylist').addEventListener('click', () => addPlaylistRow());
connectBtn.addEventListener('click', () => runSync('yt-todo-connect'));
syncBtn.addEventListener('click', () => runSync('yt-todo-sync'));

(async function init() {
  await loadTodo();
  render();
  await refreshStatus();
})();
