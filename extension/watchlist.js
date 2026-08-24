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
  const items = Object.values(todo).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
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
    meta.textContent = item.channel || '';
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
 * the OAuth token and the YouTube API calls) ── */
const syncMsg = document.getElementById('syncMsg');
const playlistInput = document.getElementById('playlistUrl');
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

async function refreshStatus() {
  if (!IN_EXTENSION) {
    document.getElementById('setupStatus').textContent = '';
    connectBtn.disabled = true;
    syncBtn.hidden = true;
    syncMsg.textContent = 'ℹ️ Ouvre cette page depuis l\'extension (icône Écoute → Dashboard → À regarder) pour connecter YouTube. Ici, seule la liste s\'affiche.';
    return;
  }
  let st;
  try { st = await chrome.runtime.sendMessage({ type: 'yt-todo-status' }); } catch { return; }
  if (!st) return;
  if (st.playlistId && !playlistInput.value) {
    playlistInput.value = `https://www.youtube.com/playlist?list=${st.playlistId}`;
  }
  document.getElementById('setupStatus').textContent = st.connected ? '✅ connecté' : '';
  syncBtn.hidden = !st.connected;
  connectBtn.textContent = st.connected ? '🔗 Reconnecter' : '🔗 Connecter & synchroniser';
  if (st.connected && st.lastSync) syncMsg.textContent = `Dernière synchro ${fmtAgo(st.lastSync)}.`;
}

async function runSync(kind) {
  if (!IN_EXTENSION) {
    syncMsg.textContent = '⚠ Ouvre cette page depuis l\'extension pour connecter YouTube.';
    return;
  }
  const url = playlistInput.value.trim();
  if (!url) { syncMsg.textContent = '⚠ Colle d\'abord l\'adresse de la playlist.'; return; }
  syncMsg.textContent = '⏳ Synchronisation…';
  connectBtn.disabled = syncBtn.disabled = true;
  let res;
  try {
    await chrome.runtime.sendMessage({ type: 'yt-todo-set-playlist', url });
    res = await chrome.runtime.sendMessage({ type: kind });
  } catch (e) {
    // e.g. "Could not establish connection" = the service worker isn't running
    // the new code (reload the extension), or it crashed on load.
    res = { ok: false, reason: String(e && e.message ? e.message : e) };
  }
  connectBtn.disabled = syncBtn.disabled = false;
  if (res && res.ok) {
    syncMsg.textContent = `✅ ${res.added} ajoutée(s), ${res.removed} retirée(s) de la playlist.`;
    await loadTodo();
    render();
  } else {
    const reason = res && res.reason;
    syncMsg.textContent = reason === 'no-auth'
      ? '⚠ Connexion YouTube refusée ou annulée.'
      : reason === 'no-playlist'
        ? '⚠ Adresse de playlist invalide.'
        : `⚠ Échec de la synchro${reason ? ' : ' + reason : ''}.`;
  }
  await refreshStatus();
}

connectBtn.addEventListener('click', () => runSync('yt-todo-connect'));
syncBtn.addEventListener('click', () => runSync('yt-todo-sync'));

(async function init() {
  await loadTodo();
  render();
  await refreshStatus();
})();
