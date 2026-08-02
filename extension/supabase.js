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
  // Supabase caps every response at 1000 rows server-side regardless of a
  // client `limit` — silently, with no error, just a truncated array. A
  // history fetch past that row count used to lose its oldest days (and
  // with them, the day streak) with no sign anything was wrong. Paginate
  // with Range until a page comes back short, so the caller always gets
  // everything the query matches.
  async listSessions(params = 'select=*') {
    const PAGE = 1000;
    let all = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await sbRequest(`listening_sessions?${params}`, {
        headers: { Range: `${offset}-${offset + PAGE - 1}` },
      });
      all = all.concat(page);
      if (page.length < PAGE) break;
    }
    return all;
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
