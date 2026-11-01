-- What to Watch: the tables behind the shared picks app.
-- Run this in the SQL editor of the sleep app's Supabase project. It reuses
-- that project's households, members and is_member(), so the same two
-- accounts sign in. Running it again is harmless, and is how a later version
-- is applied.
--
-- The phones only read picks and write "not for us" feedback. New picks
-- arrive once a week from the refresh on the home PC, through
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
  slot text not null check (slot in ('resume', 'safe', 'watchlist', 'new')),
  title text not null,
  year integer,
  kind text not null check (kind in ('movie', 'series')),
  -- A movie's runtime, a series' episode length, or for 'resume' the time left.
  minutes integer not null check (minutes > 0),
  episodes integer,
  seasons integer,
  imdb numeric(3, 1),
  rt integer check (rt between 0 and 100),
  service text not null check (service in ('prime', 'plex')),
  link text,
  poster text,
  moods text[] not null default '{}',
  why text not null,
  rank integer not null default 0
);

create index if not exists watch_picks_run on watch_picks (run_id, rank);

create table if not exists watch_feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  key text not null,
  title text not null,
  reason text not null check (reason in ('seen', 'not_me', 'not_us', 'not_tonight')),
  created_at timestamptz not null default now()
);

create index if not exists watch_feedback_household on watch_feedback (household_id, created_at);

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

-- What the phones said since a given time, for the weekly refresh.
create or replace function watch_feedback_since (p_token text, p_since timestamptz) returns table (
  created_at timestamptz,
  who text,
  key text,
  title text,
  reason text
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
    select f.created_at, m.display_name, f.key, f.title, f.reason
    from watch_feedback f
    left join members m on m.household_id = f.household_id and m.user_id = f.user_id
    where f.household_id = home and f.created_at >= p_since
    order by f.created_at;
end;
$$;

revoke all on function watch_household_for (text) from public, anon, authenticated;
grant execute on function watch_ingest (text, jsonb, text) to anon, authenticated;
grant execute on function watch_feedback_since (text, timestamptz) to anon, authenticated;

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
-- select 'keys', count(*) from watch_ingest_keys;
