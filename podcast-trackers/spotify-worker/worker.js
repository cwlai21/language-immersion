/* Écoute — Spotify podcast poller (Cloudflare Worker, free plan).
 *
 * A cron trigger fires every 2 minutes and asks Spotify what's playing
 * (server-side state — sees any device). If it's a podcast episode in a
 * French or English show, 2 minutes are credited to that episode's row for
 * today in Supabase (one row per episode per day, so titles stay visible in
 * the dashboard's session list).
 *
 * Secrets (wrangler secret put): SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
 * SPOTIFY_REFRESH_TOKEN, SUPABASE_URL, SUPABASE_KEY
 */

const CRON_INTERVAL_SECONDS = 120; // must match the cron in wrangler.toml
const TZ_OFFSET_HOURS = 8;         // Asia/Taipei (no DST)
const ROLLOVER_HOUR = 4;           // tracker day starts at 4am, like Anki

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(poll(env));
  },

  // HTTP endpoints for iPhone Shortcuts (guarded by ?token=):
  //   /start  — start a timer (says since when if already running)
  //   /stop   — stop the timer and log the session
  //   /status — show running timers with elapsed time
  //   /toggle — legacy start/stop in one URL
  //   /log?minutes=N — record minutes directly
  // Params: lang=fr|en (default fr), type (default reading), title.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('token') !== env.LOG_TOKEN) {
      return new Response('forbidden', { status: 403 });
    }
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
    const type = url.searchParams.get('type') || 'reading';
    const title = url.searchParams.get('title') || '';
    const flag = lang === 'fr' ? '🇫🇷' : '🇬🇧';
    const key = `open:${type}:${lang}`;

    const clock = (ms) => {
      const d = new Date(Number(ms) + 8 * 3600 * 1000); // Asia/Taipei
      return d.toISOString().slice(11, 16);
    };
    const elapsedMin = (ms) => Math.round((Date.now() - Number(ms)) / 60000);

    const startTimer = async () => {
      await env.STATE.put(key, String(Date.now()), { expirationTtl: 12 * 3600 });
      return new Response(`▶️ ${flag} ${type} timer started at ${clock(Date.now())}.`);
    };

    const stopTimer = async (started) => {
      await env.STATE.delete(key);
      let seconds = Math.round((Date.now() - Number(started)) / 1000);
      if (seconds < 60) return new Response('⏹ Under a minute — nothing logged.');
      seconds = Math.min(seconds, 6 * 3600);
      const minutes = Math.round(seconds / 60);
      const row = await insertRow(env, { seconds, lang, type, title, source: 'timer' });
      if (row && row.id) {
        // Remember the row so /title can label it right after.
        await env.STATE.put(
          `last:${type}:${lang}`,
          JSON.stringify({ id: row.id, minutes }),
          { expirationTtl: 3600 }
        );
      }
      return new Response(
        `✅ ${minutes}m of ${flag} ${type} (${clock(started)}–${clock(Date.now())}). What did you study?`
      );
    };

    try {
      // One-URL flow for iPhone Shortcuts (single "Open URL" action):
      // starts the timer (HTML confirmation) or stops it and shows the
      // label form directly. Everything happens in Safari.
      if (url.pathname === '/tap') {
        const started = await env.STATE.get(key);
        if (!started) {
          await env.STATE.put(key, String(Date.now()), { expirationTtl: 12 * 3600 });
          return htmlResponse(
            `<h2>▶️ ${flag} ${type} timer started at ${clock(Date.now())}.</h2>
             <p>Bonne lecture ! Open this again to stop.</p>
             <p><small>This tab closes itself in 10 seconds.</small></p>`,
            { closeAfterMs: 10000 }
          );
        }
        await env.STATE.delete(key);
        let seconds = Math.round((Date.now() - Number(started)) / 1000);
        if (seconds < 60) {
          return htmlResponse('<h2>⏹ Under a minute — nothing logged.</h2>', { closeAfterMs: 5000 });
        }
        seconds = Math.min(seconds, 6 * 3600);
        const minutes = Math.round(seconds / 60);
        const row = await insertRow(env, { seconds, lang, type, title: '', source: 'timer' });
        if (row && row.id) {
          await env.STATE.put(
            `last:${type}:${lang}`,
            JSON.stringify({ id: row.id, minutes }),
            { expirationTtl: 3600 }
          );
        }
        const action = `/title?token=${encodeURIComponent(env.LOG_TOKEN)}&lang=${lang}&type=${encodeURIComponent(type)}`;
        return htmlResponse(`
          <h2>✅ ${minutes} min of ${flag} ${type} (${clock(started)}–${clock(Date.now())}).<br>What did you study?</h2>
          ${labelForm(action)}
          <p><small>Session is already saved — the title is optional.</small></p>`);
      }

      if (url.pathname === '/start') {
        const started = await env.STATE.get(key);
        if (started) {
          return new Response(
            `⏱ Already running — ${flag} ${type} since ${clock(started)} (${elapsedMin(started)}m). Use Stop to log it.`
          );
        }
        return startTimer();
      }

      if (url.pathname === '/stop') {
        const started = await env.STATE.get(key);
        if (!started) return new Response(`🤷 No ${flag} ${type} timer running.`);
        return stopTimer(started);
      }

      if (url.pathname === '/status') {
        const { keys } = await env.STATE.list({ prefix: 'open:' });
        if (!keys.length) return new Response('🤷 No timers running.');
        const lines = [];
        for (const k of keys) {
          const startedAt = await env.STATE.get(k.name);
          const [, kType, kLang] = k.name.split(':');
          lines.push(
            `⏱ ${kLang === 'fr' ? '🇫🇷' : '🇬🇧'} ${kType} — running since ${clock(startedAt)} (${elapsedMin(startedAt)}m)`
          );
        }
        return new Response(lines.join('\n'));
      }

      if (url.pathname === '/toggle') {
        const started = await env.STATE.get(key);
        return started ? stopTimer(started) : startTimer();
      }

      // Mobile-friendly HTML form to label the most recent timer session —
      // typing in Safari is reliable, unlike Shortcuts' compact input dialog.
      if (url.pathname === '/label') {
        const lastRaw = await env.STATE.get(`last:${type}:${lang}`);
        const last = lastRaw ? JSON.parse(lastRaw) : null;
        const heading = last
          ? `✅ ${last.minutes} min of ${flag} ${type} — what did you study?`
          : `🤷 No recent ${flag} ${type} session to label.`;
        const action = `/title?token=${encodeURIComponent(env.LOG_TOKEN)}&lang=${lang}&type=${encodeURIComponent(type)}`;
        return htmlResponse(`
          <h2>${heading}</h2>
          ${last ? labelForm(action) : ''}`);
      }

      // Attach a title to the most recently stopped timer session.
      // Title comes from ?title= or a POSTed form field.
      if (url.pathname === '/title') {
        let text = url.searchParams.get('title') || '';
        let fromForm = false;
        if (request.method === 'POST') {
          try {
            const fd = await request.formData();
            if (!text) text = (fd.get('title') || '').toString();
            fromForm = fd.get('ui') === '1';
          } catch { /* no form body */ }
        }
        text = text.trim();
        if (!text) return new Response('need a title (?title= or POST form field "title")', { status: 400 });
        const lastRaw = await env.STATE.get(`last:${type}:${lang}`);
        if (!lastRaw) {
          return fromForm
            ? htmlResponse('<h2>🤷 No recent session to label.</h2>')
            : new Response('🤷 No recent session to label.');
        }
        const last = JSON.parse(lastRaw);
        await sb(env, `listening_sessions?id=eq.${last.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: text }),
        });
        const msg = `📝 Saved — ${last.minutes}m of ${flag} ${type}: “${text}”`;
        return fromForm
          ? htmlResponse(`<h2>${msg}</h2>`, { closeAfterMs: 1500 })
          : new Response(msg);
      }

      if (url.pathname === '/log') {
        const minutes = parseInt(url.searchParams.get('minutes'), 10);
        if (!minutes || minutes < 1 || minutes > 1440) {
          return new Response('need ?minutes=1..1440', { status: 400 });
        }
        await insertRow(env, { seconds: minutes * 60, lang, type, title, source: 'manual' });
        return new Response(`✅ Logged ${minutes}m of ${flag} ${type}.`);
      }
    } catch (e) {
      return new Response(`error: ${e.message}`, { status: 500 });
    }
    return new Response('routes: /start /stop /status /toggle /log?minutes=N (params: lang=fr|en, type, title)', { status: 404 });
  },
};

// Form that submits via fetch so the tab never navigates — a tab opened from
// Shortcuts may self-close only while it has no navigation history.
function labelForm(action) {
  return `
    <form id="labelform">
      <input name="title" autofocus autocomplete="off" placeholder="e.g. Le Petit Prince, ch. 3">
      <button type="submit">Save 📝</button>
    </form>
    <script>
      document.getElementById('labelform').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          const fd = new FormData(e.target);
          const res = await fetch('${action}', { method: 'POST', body: fd });
          if (!res.ok) throw new Error(res.status);
          document.body.innerHTML = '<h2>📝 Saved !</h2>';
          setTimeout(() => { window.open('', '_self'); window.close(); }, 800);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Save 📝 (retry)';
        }
      });
    </script>`;
}

function htmlResponse(body, { closeAfterMs } = {}) {
  // window.close() works in iOS Safari for tabs opened from another app
  // (like Shortcuts' Open URL) because they have no navigation history.
  const closer = closeAfterMs
    ? `<script>setTimeout(() => { window.open('', '_self'); window.close(); }, ${closeAfterMs});</script>`
    : '';
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <title>Écoute</title>${closer}
     <style>
       body { font-family: -apple-system, sans-serif; margin: 0; padding: 28px 20px;
              background: #f4f6fb; color: #1a2033; }
       h2 { font-size: 20px; line-height: 1.4; }
       input[name=title] { width: 100%; box-sizing: border-box; font-size: 18px;
              padding: 14px; border: 1px solid #cdd3e1; border-radius: 12px; margin: 14px 0; }
       button { width: 100%; font-size: 18px; font-weight: 600; padding: 14px;
              border: none; border-radius: 12px; background: #2b4fd8; color: #fff; }
     </style></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function insertRow(env, { seconds, lang, type, title, source }) {
  const rows = await sb(env, 'listening_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      date: logicalDate(),
      seconds,
      language: lang,
      type,
      title,
      channel: '',
      source,
    }),
  });
  return rows && rows[0];
}

async function poll(env) {
  const token = await accessToken(env);
  const res = await fetch(
    'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 204) return; // nothing playing
  if (!res.ok) {
    console.log(`spotify error ${res.status}`);
    return;
  }
  const body = await res.json();
  const item = body.item;
  if (!body.is_playing || !item || item.type !== 'episode') return;

  const langs = (item.show?.languages || []).map((l) => l.toLowerCase());
  const lang = langs.some((l) => l.startsWith('fr')) ? 'fr'
    : langs.some((l) => l.startsWith('en')) ? 'en'
    : null;
  if (!lang) return; // untracked language (e.g. Chinese shows)

  await credit(env, {
    date: logicalDate(),
    lang,
    episodeId: item.id,
    title: item.name || '',
    show: item.show?.name || '',
  });
}

function logicalDate() {
  // Local Taipei time shifted back to the 4am boundary, as a YYYY-MM-DD key.
  const shifted = new Date(Date.now() + (TZ_OFFSET_HOURS - ROLLOVER_HOUR) * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function accessToken(env) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function credit(env, { date, lang, episodeId, title, show }) {
  const existing = await sb(
    env,
    `listening_sessions?date=eq.${date}&source=eq.spotify&video_id=eq.${encodeURIComponent(episodeId)}&select=id,seconds`
  );
  if (existing.length) {
    await sb(env, `listening_sessions?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ seconds: existing[0].seconds + CRON_INTERVAL_SECONDS }),
    });
  } else {
    await sb(env, 'listening_sessions', {
      method: 'POST',
      body: JSON.stringify({
        date,
        seconds: CRON_INTERVAL_SECONDS,
        language: lang,
        type: 'podcast',
        title,
        channel: show,
        video_id: episodeId,
        source: 'spotify',
      }),
    });
  }
  console.log(`credited ${CRON_INTERVAL_SECONDS}s [${lang}] ${show} — ${title}`);
}
