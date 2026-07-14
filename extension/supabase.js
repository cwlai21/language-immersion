// Minimal Supabase REST helper. Works in the service worker (importScripts)
// and in extension pages (script tag after config.js).

async function sbRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sb = {
  insertSession(row) {
    return sbRequest('listening_sessions', {
      method: 'POST',
      body: row,
      headers: { Prefer: 'return=representation' },
    });
  },
  // params: PostgREST query string, e.g. 'select=date,seconds&date=gte.2026-07-01'
  listSessions(params = 'select=*') {
    return sbRequest(`listening_sessions?${params}`);
  },
  deleteSession(id) {
    return sbRequest(`listening_sessions?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
  updateSession(id, patch) {
    return sbRequest(`listening_sessions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    });
  },
};
