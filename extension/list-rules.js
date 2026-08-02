// Pure list-view logic shared by the dashboard (loaded as a <script> tag,
// browser globals) and its Node test suite (test/list-rules.test.js, via
// require()). No DOM, no chrome.*, no network — but groupSameContent needs
// watchKey (rules.js) and sessionRowFields needs t() (i18n.js): globals in
// the browser (both load before this file, see dashboard.html), required
// directly here in Node.
let watchKey, pad, t;
if (typeof require !== 'undefined') {
  ({ watchKey, pad } = require('./rules.js'));
  ({ t } = require('./i18n.js'));
} else {
  watchKey = globalThis.watchKey;
  pad = globalThis.pad;
  t = globalThis.t;
}

const hm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function fmtMinutes(mins) {
  mins = Math.round(mins);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Union overlapping/adjacent (≤2 min apart) intervals.
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 120000) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

// Clock interval [startMs, endMs] for a row, or null when meaningless.
// Spotify rows are created at session start (then grown); the other live
// trackers insert at session end. Anki/import/manual have no useful clock.
function sessionInterval(s) {
  if (!s.created_at || !['auto', 'timer', 'apple', 'spotify'].includes(s.source)) return null;
  const created = new Date(s.created_at).getTime();
  return s.source === 'spotify'
    ? [created, created + s.seconds * 1000]
    : [created - s.seconds * 1000, created];
}

// Todo-able content groups by title across days; anki keeps per-day rows;
// untitled rows stay solo.
function groupSameContent(sessions) {
  const byKey = new Map();
  for (const s of sessions) {
    const k = watchKey(s) || (s.title ? `${s.date}|${s.title}|${s.channel}` : `solo|${s.id}`);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  return [...byKey.values()];
}

// Shared field computation for a group of merged rows (same content, one or
// more days) — used by both the Recent Sessions list and the CSV export so
// the two can't drift out of formatting sync.
function sessionRowFields(rows) {
  const s = rows[0];
  const episodeTag = s.type === 'series' && s.season && s.episode ? `S${s.season}E${s.episode} · ` : '';
  const title = episodeTag + (s.title || t('untitled'));

  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const dateText = dates.length > 1 ? `${dates[0]} → ${dates[dates.length - 1]}` : s.date;
  // Clock ranges only make sense within a single day.
  const intervals = dates.length > 1 ? [] : mergeIntervals(rows.map(sessionInterval).filter(Boolean));
  const timeText = intervals.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', ');

  const auto = rows.some((r) => ['auto', 'anki', 'apple', 'spotify'].includes(r.source));
  const imported = rows.some((r) => r.source === 'import');

  const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0);
  // A single combined total across days hides how it's actually split —
  // e.g. "55m" for a podcast episode listened to in a 37m sitting one day
  // and an 18m sitting the next reads as one continuous block. Show each
  // day's own total instead, oldest first (matching the date range above).
  let durationText;
  if (dates.length > 1) {
    const byDate = {};
    for (const r of rows) byDate[r.date] = (byDate[r.date] || 0) + r.seconds;
    durationText = dates.map((d) => fmtMinutes(byDate[d] / 60)).join(' + ');
  } else {
    durationText = fmtMinutes(totalSeconds / 60);
  }

  return { s, title, dateText, timeText, channel: s.channel || '', auto, imported, durationText, totalSeconds };
}

if (typeof module !== 'undefined') {
  module.exports = { mergeIntervals, sessionInterval, groupSameContent, sessionRowFields };
}
