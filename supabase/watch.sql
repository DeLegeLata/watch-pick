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
-- canon (added 2026-11-18): "Should have seen", from the daily catalogue.
alter table watch_picks drop constraint if exists watch_picks_slot_check;
alter table watch_picks add constraint watch_picks_slot_check
check (slot in ('resume', 'safe', 'watchlist', 'canon', 'new', 'rate'));

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
-- not_them (added 2026-11-18): the tapper's guess that the other person
-- wouldn't like it ("Not for Sarah" on Stuart's phone).
alter table watch_feedback drop constraint if exists watch_feedback_reason_check;
alter table watch_feedback add constraint watch_feedback_reason_check
check (reason in ('seen', 'not_me', 'not_them', 'not_us', 'not_tonight', 'someone_else'));

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
-- One list for both of them, whatever service a title is on. Each title
-- records who wants it (watch_list_wants, added 2026-11-07): a pick saved or
-- a name typed on a phone is that person's, and a title on Stuart's or
-- Sarah's own Prime or Plex watchlist is theirs. A title they both want is
-- the sweet spot. The refresh matches typed names, pulls in those
-- watchlists, and keeps where each title can be watched up to date. Nothing
-- is written back to Prime or Plex.

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
  -- How it first arrived, and from whom: app is added on a phone; prime /
  -- plex is pulled in from a watchlist there. Who wants it now is in
  -- watch_list_wants.
  source text not null default 'app' check (source in ('app', 'prime', 'plex')),
  added_by uuid default auth.uid () references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  checked_at timestamptz,
  -- Off the list: nobody wants it any more (kept in step by a trigger on
  -- watch_list_wants). The row stays so it isn't pulled in again.
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

-- --- Who wants each title (added 2026-11-07) ---------------------------------
-- Each of them has their own list inside the shared one: Mine, Sarah's or
-- Stuart's, and Both where they overlap. Taking a title off sets only your
-- own removed_at; the row stays, so the refresh doesn't pull it in for you
-- again. The title leaves the list once neither of them wants it.

create table if not exists watch_list_wants (
  item_id uuid not null references watch_list (id) on delete cascade,
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  -- app: saved or typed on a phone; prime / plex: on this person's watchlist there.
  via text not null default 'app' check (via in ('app', 'prime', 'plex')),
  wanted_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (item_id, user_id)
);

alter table watch_list_wants enable row level security;

drop policy if exists watch_list_wants_read on watch_list_wants;
create policy watch_list_wants_read on watch_list_wants for select using (
  exists (select 1 from watch_list l where l.id = watch_list_wants.item_id and is_member (l.household_id))
);

drop policy if exists watch_list_wants_add on watch_list_wants;
create policy watch_list_wants_add on watch_list_wants for insert
with
  check (
    user_id = auth.uid () and via = 'app'
    and exists (select 1 from watch_list l where l.id = watch_list_wants.item_id and is_member (l.household_id))
  );

drop policy if exists watch_list_wants_change on watch_list_wants;
create policy watch_list_wants_change on watch_list_wants for update using (user_id = auth.uid ())
with
  check (user_id = auth.uid ());

-- Each phone only takes its own wants off and puts them back.
revoke update on watch_list_wants from anon, authenticated;
grant update (removed_at, wanted_at) on watch_list_wants to authenticated;

-- Whoever adds a title wants it. This also covers a phone still on the
-- version from before 2026-11-07, which writes only watch_list.
create or replace function watch_list_first_want () returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.added_by is not null then
    insert into public.watch_list_wants (item_id, user_id, via, wanted_at)
    values (new.id, new.added_by, new.source, new.added_at)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists watch_list_first_want on watch_list;
create trigger watch_list_first_want after insert on watch_list
for each row execute function watch_list_first_want ();

-- A title is on the list while anyone wants it.
create or replace function watch_list_follow_wants () returns trigger language plpgsql
set search_path = '' as $$
begin
  update public.watch_list l
  set removed_at = case
    when exists (select 1 from public.watch_list_wants w where w.item_id = l.id and w.removed_at is null) then null
    else coalesce(l.removed_at, now())
  end
  where l.id = new.item_id;
  return null;
end;
$$;

drop trigger if exists watch_list_wants_follow on watch_list_wants;
create trigger watch_list_wants_follow after insert or update on watch_list_wants
for each row execute function watch_list_follow_wants ();

-- First names, for the phones' "Sarah's" and "Added by Stuart".
update members set display_name = 'Stuart' where display_name ilike 'stuart%' and display_name <> 'Stuart';
update members set display_name = 'Sarah' where display_name ilike 'sarah%' and display_name <> 'Sarah';

-- Everything on the list before 2026-11-07 was Stuart's: his Prime and Plex
-- watchlists, and anything saved or typed while both phones were signed in
-- as him.
insert into watch_list_wants (item_id, user_id, via, wanted_at, removed_at)
select l.id, m.user_id, l.source, l.added_at, l.removed_at
from watch_list l
join members m on m.household_id = l.household_id and m.display_name = 'Stuart'
where not exists (select 1 from watch_list_wants w where w.item_id = l.id)
on conflict do nothing;

-- A phone saying "I want this": a saved pick, a typed name, or Me too on a
-- title already on the list (p_item then has its id). It runs as the
-- person, so row-level security applies.
create or replace function watch_list_want (p_household uuid, p_item jsonb) returns uuid language plpgsql
set search_path = '' as $$
declare
  item uuid := (p_item ->> 'id')::uuid;
  item_key text := nullif(p_item ->> 'key', '');
begin
  if item is null and item_key is not null then
    select l.id into item from public.watch_list l where l.household_id = p_household and l.key = item_key;
  end if;
  if item is null then
    insert into public.watch_list (household_id, key, typed, title, year, kind, minutes, episodes, seasons, imdb,
                                   rt, service, link, poster)
    select p_household, item_key, x.typed, x.title, x.year, x.kind, x.minutes, x.episodes, x.seasons, x.imdb,
           x.rt, x.service, x.link, x.poster
    from jsonb_populate_record(null::public.watch_list, p_item) x
    returning id into item;
  end if;
  insert into public.watch_list_wants (item_id) values (item)
  on conflict (item_id, user_id) do update set removed_at = null, wanted_at = now();
  return item;
end;
$$;

-- The whole list, for the refresh. wants: who wants it and how, e.g.
-- "Sarah (app), Stuart (prime)"; taken_off: who took it off their own list.
drop function if exists watch_list_read (text);
create function watch_list_read (p_token text) returns table (
  id uuid,
  key text,
  typed text,
  title text,
  year integer,
  service text,
  note text,
  source text,
  who text,
  wants text,
  taken_off text,
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
           (select string_agg(p.display_name || ' (' || w.via || ')', ', ' order by p.display_name)
            from watch_list_wants w join members p on p.household_id = l.household_id and p.user_id = w.user_id
            where w.item_id = l.id and w.removed_at is null),
           (select string_agg(p.display_name, ', ' order by p.display_name)
            from watch_list_wants w join members p on p.household_id = l.household_id and p.user_id = w.user_id
            where w.item_id = l.id and w.removed_at is not null),
           l.added_at, l.checked_at, l.removed_at
    from watch_list l
    left join members m on m.household_id = l.household_id and m.user_id = l.added_by
    where l.household_id = home
    order by l.removed_at nulls first, l.added_at desc;
end;
$$;

-- The refresh's changes. Each row of p_rows is one title, by key:
-- - with an id and a key: a typed name, now matched (its wants move with it);
-- - with an id and no key: a typed name it couldn't match (only note is kept);
-- - with who and via: on that person's Prime or Plex watchlist, so it goes on
--   their list, unless they took it off before;
-- - with neither: a recheck of a title already on the list.
-- p_remove takes titles off for both of them by key, e.g. once they've watched them.
create or replace function watch_list_save (p_token text, p_rows jsonb, p_remove text[] default '{}') returns integer language plpgsql security definer
set
  search_path = public, extensions as $$
declare
  home uuid := watch_household_for(p_token);
  r record;
  other uuid;
  person uuid;
  item uuid;
  saved integer := 0;
begin
  if home is null then
    raise exception 'watch_list_save: unknown token' using errcode = '28000';
  end if;

  for r in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]')) as x (
      id uuid, key text, title text, year integer, kind text, minutes integer, episodes integer,
      seasons integer, imdb numeric, rt integer, service text, link text, poster text, note text,
      who text, via text
    )
  loop
    if r.id is not null and r.key is null then
      update watch_list set note = r.note, checked_at = now() where id = r.id and household_id = home;
      saved := saved + 1;
      continue;
    end if;

    person := null;
    if r.who is not null then
      select m.user_id into person from members m
      where m.household_id = home and m.display_name ilike (r.who || '%') limit 1;
      if person is null then
        raise exception 'watch_list_save: nobody called %', r.who;
      end if;
    end if;

    if r.id is null and person is null then
      update watch_list set
        title = r.title, year = r.year, kind = r.kind, minutes = r.minutes, episodes = r.episodes,
        seasons = r.seasons, imdb = r.imdb, rt = r.rt, service = r.service, link = r.link,
        poster = r.poster, note = r.note, checked_at = now()
      where household_id = home and key = r.key;
      saved := saved + 1;
      continue;
    end if;

    if r.id is not null then
      select l.id into other from watch_list l where l.household_id = home and l.key = r.key and l.id <> r.id;
      if other is null then
        update watch_list set key = r.key where id = r.id and household_id = home;
      else
        -- Typed again for a title already on the list: whoever typed it now
        -- wants that row, which comes back if it had been taken off.
        insert into watch_list_wants (item_id, user_id, via, wanted_at)
        select other, w.user_id, w.via, w.wanted_at from watch_list_wants w
        where w.item_id = r.id and w.removed_at is null
        on conflict (item_id, user_id) do update set removed_at = null;
        delete from watch_list where id = r.id and household_id = home;
      end if;
    end if;

    insert into watch_list (household_id, key, title, year, kind, minutes, episodes, seasons, imdb, rt,
                            service, link, poster, note, source, added_by, checked_at)
    values (home, r.key, r.title, r.year, r.kind, r.minutes, r.episodes, r.seasons, r.imdb, r.rt,
            r.service, r.link, r.poster, r.note, coalesce(r.via, 'app'), person, now())
    on conflict (household_id, key) do update set
      title = excluded.title, year = excluded.year, kind = excluded.kind, minutes = excluded.minutes,
      episodes = excluded.episodes, seasons = excluded.seasons, imdb = excluded.imdb, rt = excluded.rt,
      service = excluded.service, link = excluded.link, poster = excluded.poster, note = excluded.note,
      checked_at = now()
    returning id into item;

    if person is not null then
      insert into watch_list_wants (item_id, user_id, via) values (item, person, r.via)
      on conflict (item_id, user_id) do nothing;
    end if;
    saved := saved + 1;
  end loop;

  update watch_list_wants w set removed_at = now()
  from watch_list l
  where l.id = w.item_id and l.household_id = home and l.key = any (coalesce(p_remove, '{}'))
    and w.removed_at is null;
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
revoke all on function watch_list_want (uuid, jsonb) from public, anon;
grant execute on function watch_list_want (uuid, jsonb) to authenticated;

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
