-- Écoute — Listening Tracker (French + English + Anki)
-- Run in Supabase → SQL Editor. Safe to re-run: every statement is
-- idempotent, and it also upgrades tables created by older versions of
-- this file (adds the language column, refreshes the type/source checks).

create table if not exists listening_sessions (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  seconds    integer not null check (seconds > 0),
  language   text not null default 'fr',
  type       text not null default 'youtube',
  title      text not null default '',
  channel    text not null default '',
  video_id   text not null default '',
  source     text not null default 'auto',
  created_at timestamptz not null default now()
);

-- Upgrade path for tables created before the language column existed.
alter table listening_sessions
  add column if not exists language text not null default 'fr';

-- Rebuild the value checks so they always match the current app: drop every
-- check constraint on the table (their names vary between versions of this
-- file), then recreate the canonical set.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'listening_sessions'::regclass and contype = 'c'
  loop
    execute format('alter table listening_sessions drop constraint %I', r.conname);
  end loop;
end $$;

alter table listening_sessions add constraint listening_sessions_seconds_check
  check (seconds > 0);
alter table listening_sessions add constraint listening_sessions_language_check
  check (language in ('fr', 'en'));
alter table listening_sessions add constraint listening_sessions_type_check
  check (type in ('youtube', 'podcast', 'anki', 'reading'));
alter table listening_sessions add constraint listening_sessions_source_check
  check (source in ('auto', 'manual', 'timer', 'anki', 'apple', 'spotify', 'import'));

create index if not exists idx_listening_sessions_date on listening_sessions (date);

-- Same open-anon-access model as the habit-tracker tables (personal project,
-- protected only by the unguessable anon key).
alter table listening_sessions enable row level security;

drop policy if exists "anon full access" on listening_sessions;
create policy "anon full access" on listening_sessions
  for all to anon using (true) with check (true);

-- Tiny strongly-consistent key/value store for the Cloudflare worker's
-- timer state (Workers KV is eventually consistent, which broke the
-- "French and English can't overlap" guard).
create table if not exists kv_state (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table kv_state enable row level security;

drop policy if exists "anon full access" on kv_state;
create policy "anon full access" on kv_state
  for all to anon using (true) with check (true);
