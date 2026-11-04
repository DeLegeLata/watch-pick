-- What to Watch: the tables behind the shared picks app.
-- Run this in the SQL editor of the sleep app's Supabase project. It reuses
-- that project's households, members and is_member(), so the same two
-- accounts sign in. Running it again is harmless, and is how a later version
-- is applied.
--
-- The phones read picks, write feedback ("not for us", "seen" with a rating)
-- and add to the shared watchlist. New picks arrive daily from the refresh on
-- the home PC, through
-- watch_ingest(), which checks a long random token whose SHA-256 hash is
-- kept in watch_ingest_keys. The token itself lives only in the PC's
-- git-ignored .env.local.

create extension if not exists pgcrypto with schema extensions;

create table if not exists watch_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  ran_at timestamptz not null default now(),
  note text
);

create table if not exists watch_picks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  run_id uuid not null references watch_runs (id) on delete cascade,
  -- Stable across runs, so feedback on a title outlives the run it came in.
  key text not null,
  slot text not null,
  title text not null,
  year integer,
  kind text not null check (kind in ('movie', 'series')),
  -- A movie's runtime, a series' episode length, or for 'resume' the time left.
  minutes integer not null check (minutes > 0),
  episodes integer,
  seasons integer,
  imdb numeric(3, 1),
  rt integer check (rt between 0 and 100),
  -- prime: included with Prime; plex: on the shared Plex server; shudder: the
  -- Shudder channel on Prime, while it lasts.
  service text not null check (service in ('prime', 'plex', 'shudder')),
  link text,
  poster text,
  moods text[] not null default '{}',
  why text not null,
  rank integer not null default 0
);

create index if not exists watch_picks_run on watch_picks (run_id, rank);

-- rate (added 2026-11-02): not a pick but something the refresh saw them
-- watch, which the phones ask "How was it?" about.
alter table watch_picks drop constraint if exists watch_picks_slot_check;
alter table watch_picks add constraint watch_picks_slot_check
check (slot in ('resume', 'safe', 'watchlist', 'new', 'rate'));

create table if not exists watch_feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  key text not null,
  title text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists watch_feedback_household on watch_feedback (household_id, created_at);

-- Added 2026-11-02: for 'seen', how this person found it, 1 (didn't like it)
-- to 4 (loved it); 0 is "didn't watch it"; null is not rated yet.
alter table watch_feedback add column if not exists rating smallint check (rating between 0 and 4);

-- someone_else (added 2026-11-02): a "pick up where you left off" card whose
-- progress was someone else's on the shared account, not theirs.
alter table watch_feedback drop constraint if exists watch_feedback_reason_check;
alter table watch_feedback add constraint watch_feedback_reason_check
check (reason in ('seen', 'not_me', 'not_us', 'not_tonight', 'someone_else'));

create table if not exists watch_ingest_keys (
  household_id uuid primary key references households (id) on delete cascade,
  token_hash bytea not null,
  created_at timestamptz not null default now()
);

-- --- Row-level security ------------------------------------------------------

alter table watch_runs enable row level security;
alter table watch_picks enable row level security;
alter table watch_feedback enable row level security;
-- No policies on purpose: only the security-definer functions below reach it.
alter table watch_ingest_keys enable row level security;

drop policy if exists watch_runs_read on watch_runs;
create policy watch_runs_read on watch_runs for select using (is_member (household_id));

drop policy if exists watch_picks_read on watch_picks;
create policy watch_picks_read on watch_picks for select using (is_member (household_id));

drop policy if exists watch_feedback_read on watch_feedback;
create policy watch_feedback_read on watch_feedback for select using (is_member (household_id));

drop policy if exists watch_feedback_add on watch_feedback;
create policy watch_feedback_add on watch_feedback for insert
with
  check (is_member (household_id) and user_id = auth.uid ());

-- Undo removes only your own tap.
drop policy if exists watch_feedback_undo on watch_feedback;
create policy watch_feedback_undo on watch_feedback for delete using (user_id = auth.uid ());

-- --- The PC's door in ----------------------------------------------------------

create or replace function watch_household_for (p_token text) returns uuid language sql stable security definer
set
  search_path = public, extensions as $$
  select household_id from watch_ingest_keys
  where token_hash = digest(p_token, 'sha256');
$$;

-- Replaces the current picks with a new run and keeps the last 8 runs.
-- p_picks is a JSON array of objects with the watch_picks columns.
create or replace function watch_ingest (p_token text, p_picks jsonb, p_note text default null) returns integer language plpgsql security definer
set
  search_path = public, extensions as $$
declare
  home uuid := watch_household_for(p_token);
  run uuid;
  added integer;
begin
  if home is null then
    raise exception 'watch_ingest: unknown token' using errcode = '28000';
  end if;
  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) = 0 then
    raise exception 'watch_ingest: picks must be a non-empty array';
  end if;

  insert into watch_runs (household_id, note) values (home, p_note) returning id into run;

  insert into watch_picks (household_id, run_id, key, slot, title, year, kind, minutes, episodes,
                           seasons, imdb, rt, service, link, poster, moods, why, rank)
  select home, run, p.key, p.slot, p.title, p.year, p.kind, p.minutes, p.episodes,
         p.seasons, p.imdb, p.rt, p.service, p.link, p.poster, coalesce(p.moods, '{}'), p.why,
         coalesce(p.rank, 0)
  from jsonb_to_recordset(p_picks) as p (
    key text, slot text, title text, year integer, kind text, minutes integer, episodes integer,
    seasons integer, imdb numeric, rt integer, service text, link text, poster text,
    moods text[], why text, rank integer
  );
  get diagnostics added = row_count;

  delete from watch_runs
  where household_id = home
    and id not in (
      select id from watch_runs where household_id = home order by ran_at desc limit 8
    );

  return added;
end;
$$;

-- What the phones said since a given time, for the daily refresh. Dropped
-- first because adding the rating column changed what it returns.
drop function if exists watch_feedback_since (text, timestamptz);
create function watch_feedback_since (p_token text, p_since timestamptz) returns table (
  created_at timestamptz,
  who text,
  key text,
  title text,
  reason text,
  rating smallint
) language plpgsql stable security definer
set
  search_path = public, extensions as $$
declare
  home uuid := watch_household_for(p_token);
begin
  if home is null then
    raise exception 'watch_feedback_since: unknown token' using errcode = '28000';
  end if;
  return query
    select f.created_at, m.display_name, f.key, f.title, f.reason, f.rating
    from watch_feedback f
    left join members m on m.household_id = f.household_id and m.user_id = f.user_id
    where f.household_id = home and f.created_at >= p_since
    order by f.created_at;
end;
$$;

-- --- The shared watchlist (added 2026-11-03) ---------------------------------
-- One list for both of them, whatever service a title is on. The phones add
-- to it (a saved pick, or a typed name) and take titles off it. The refresh
-- matches typed names, pulls in Prime's and Plex's watchlists, and keeps
-- where each title can be watched up to date. Nothing is written back to
-- Prime or Plex.

create table if not exists watch_list (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  -- The same key as the picks (title words plus year). Null while a typed
  -- name waits for the refresh to match it.
  key text,
  -- What someone typed on a phone, kept after it's matched.
  typed text,
  title text not null,
  year integer,
  kind text check (kind in ('movie', 'series')),
  minutes integer check (minutes > 0),
  episodes integer,
  seasons integer,
  imdb numeric(3, 1),
  rt integer check (rt between 0 and 100),
  -- Where they can watch it now; null means not on anything they have.
  service text check (service in ('prime', 'plex', 'shudder')),
  link text,
  poster text,
  -- The refresh's word on it, e.g. "On Netflix" or "Couldn't find this".
  note text,
  -- app: added on a phone; prime / plex: pulled in from that watchlist.
  source text not null default 'app' check (source in ('app', 'prime', 'plex')),
  added_by uuid default auth.uid () references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  checked_at timestamptz,
  -- Taken off the list. The row stays so a removed import isn't pulled in again.
  removed_at timestamptz,
  constraint watch_list_key unique (household_id, key)
);

alter table watch_list enable row level security;

drop policy if exists watch_list_read on watch_list;
create policy watch_list_read on watch_list for select using (is_member (household_id));

drop policy if exists watch_list_add on watch_list;
create policy watch_list_add on watch_list for insert
with
  check (is_member (household_id) and source = 'app' and added_by = auth.uid ());

drop policy if exists watch_list_take_off on watch_list;
create policy watch_list_take_off on watch_list for update using (is_member (household_id))
with
  check (is_member (household_id));

-- The phones only take titles off and put them back; the refresh fills in the rest.
revoke update on watch_list from anon, authenticated;
grant update (removed_at, added_at) on watch_list to authenticated;

-- The whole list, for the refresh.
create or replace function watch_list_read (p_token text) returns table (
  id uuid,
  key text,
  typed text,
  title text,
  year integer,
  service text,
  note text,
  source text,
  who text,
  added_at timestamptz,
  checked_at timestamptz,
  removed_at timestamptz
) language plpgsql stable security definer
set
  search_path = public, extensions as $$
declare
  home uuid := watch_household_for(p_token);
begin
  if home is null then
    raise exception 'watch_list_read: unknown token' using errcode = '28000';
  end if;
  return query
    select l.id, l.key, l.typed, l.title, l.year, l.service, l.note, l.source, m.display_name,
           l.added_at, l.checked_at, l.removed_at
    from watch_list l
    left join members m on m.household_id = l.household_id and m.user_id = l.added_by
    where l.household_id = home
    order by l.removed_at nulls first, l.added_at desc;
end;
$$;

-- The refresh's changes. Each row of p_rows is one title, by key:
-- - with an id and a key: a typed name, now matched;
-- - with an id and no key: a typed name it couldn't match (only note is kept);
-- - with no id: pulled in from Prime or Plex (source), or rechecked. A title
--   already on the list keeps its source and stays removed if it was.
-- p_remove takes titles off by key, e.g. once they've watched them.
create or replace function watch_list_save (p_token text, p_rows jsonb, p_remove text[] default '{}') returns integer language plpgsql security definer
set
  search_path = public, extensions as $$
declare
  home uuid := watch_household_for(p_token);
  r record;
  other uuid;
  saved integer := 0;
begin
  if home is null then
    raise exception 'watch_list_save: unknown token' using errcode = '28000';
  end if;

  for r in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]')) as x (
      id uuid, key text, title text, year integer, kind text, minutes integer, episodes integer,
      seasons integer, imdb numeric, rt integer, service text, link text, poster text, note text,
      source text
    )
  loop
    if r.id is not null and r.key is null then
      update watch_list set note = r.note, checked_at = now() where id = r.id and household_id = home;
      saved := saved + 1;
      continue;
    end if;

    if r.id is not null then
      -- Typed again for a title already on the list: keep that row, and put it
      -- back if it had been taken off.
      select l.id into other from watch_list l where l.household_id = home and l.key = r.key and l.id <> r.id;
      if other is null then
        update watch_list set key = r.key where id = r.id and household_id = home;
      else
        delete from watch_list where id = r.id and household_id = home;
        update watch_list set removed_at = null where id = other;
      end if;
    end if;

    insert into watch_list (household_id, key, title, year, kind, minutes, episodes, seasons, imdb, rt,
                            service, link, poster, note, source, added_by, checked_at)
    values (home, r.key, r.title, r.year, r.kind, r.minutes, r.episodes, r.seasons, r.imdb, r.rt,
            r.service, r.link, r.poster, r.note, coalesce(r.source, 'prime'), null, now())
    on conflict (household_id, key) do update set
      title = excluded.title, year = excluded.year, kind = excluded.kind, minutes = excluded.minutes,
      episodes = excluded.episodes, seasons = excluded.seasons, imdb = excluded.imdb, rt = excluded.rt,
      service = excluded.service, link = excluded.link, poster = excluded.poster, note = excluded.note,
      checked_at = now();
    saved := saved + 1;
  end loop;

  update watch_list set removed_at = now()
  where household_id = home and key = any (coalesce(p_remove, '{}')) and removed_at is null;

  return saved;
end;
$$;

revoke all on function watch_household_for (text) from public, anon, authenticated;
grant execute on function watch_ingest (text, jsonb, text) to anon, authenticated;
grant execute on function watch_feedback_since (text, timestamptz) to anon, authenticated;
grant execute on function watch_list_read (text) to anon, authenticated;
grant execute on function watch_list_save (text, jsonb, text[]) to anon, authenticated;

-- --- After running the above ---------------------------------------------------
-- Run the one line in supabase/ingest-key.local.sql on the home PC (it is
-- git-ignored). It stores the hash of the PC's token for the household:
--
--   insert into watch_ingest_keys (household_id, token_hash)
--   select id, decode('<sha256 hex>', 'hex') from households limit 1
--   on conflict (household_id) do update set token_hash = excluded.token_hash;
--
-- Check: this should list the table names with their row counts.
-- select 'runs' t, count(*) from watch_runs union all
-- select 'picks', count(*) from watch_picks union all
-- select 'list', count(*) from watch_list union all
-- select 'keys', count(*) from watch_ingest_keys;
