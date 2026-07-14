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

  // HTTP endpoint for iPhone Shortcuts: /toggle starts/stops a reading timer
  // (state in KV), /log records minutes directly. Guarded by ?token=.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('token') !== env.LOG_TOKEN) {
      return new Response('forbidden', { status: 403 });
    }
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
    const type = url.searchParams.get('type') || 'reading';
    const title = url.searchParams.get('title') || '';
    const flag = lang === 'fr' ? '🇫🇷' : '🇬🇧';

    try {
      if (url.pathname === '/toggle') {
        const key = `open:${type}:${lang}`;
        const started = await env.STATE.get(key);
        if (!started) {
          await env.STATE.put(key, String(Date.now()), { expirationTtl: 12 * 3600 });
          return new Response(`▶️ Started ${type} ${flag} — tap again to stop.`);
        }
        await env.STATE.delete(key);
        let seconds = Math.round((Date.now() - Number(started)) / 1000);
        if (seconds < 60) return new Response('⏹ Under a minute — discarded.');
        seconds = Math.min(seconds, 6 * 3600);
        await insertRow(env, { seconds, lang, type, title, source: 'timer' });
        return new Response(`✅ Logged ${Math.round(seconds / 60)}m of ${type} ${flag}.`);
      }

      if (url.pathname === '/log') {
        const minutes = parseInt(url.searchParams.get('minutes'), 10);
        if (!minutes || minutes < 1 || minutes > 1440) {
          return new Response('need ?minutes=1..1440', { status: 400 });
        }
        await insertRow(env, { seconds: minutes * 60, lang, type, title, source: 'manual' });
        return new Response(`✅ Logged ${minutes}m of ${type} ${flag}.`);
      }
    } catch (e) {
      return new Response(`error: ${e.message}`, { status: 500 });
    }
    return new Response('routes: /toggle /log?minutes=N (params: lang=fr|en, type, title)', { status: 404 });
  },
};

async function insertRow(env, { seconds, lang, type, title, source }) {
  await sb(env, 'listening_sessions', {
    method: 'POST',
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
