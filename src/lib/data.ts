// Reads the latest run's picks, the household's feedback and the shared
// watchlist; writes "not for us" taps and watchlist adds. The last snapshot is
// kept in localStorage so the app opens with no signal.
import { supabase } from './supabase';
import type { Feedback, ListItem, NewItem, Pick, Reason, Run, Unrated } from './model';

export interface Snapshot {
  household: string | null;
  run: Run | null;
  picks: Pick[];
  feedback: Feedback[];
  /** The shared watchlist, without what's been taken off. */
  list: ListItem[];
  /** False when the database hasn't had the watchlist part of watch.sql yet. */
  listReady: boolean;
  /** Each member's display name, by user id. */
  names: Record<string, string>;
}

const CACHE = 'watch-pick:snapshot';
const PICK_COLUMNS =
  'key, slot, title, year, kind, minutes, episodes, seasons, imdb, rt, service, link, poster, moods, why, rank';

export function cached(): Snapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(CACHE) ?? 'null');
    // A snapshot saved before the watchlist existed has no list.
    return s ? { list: [], listReady: true, names: {}, ...s } : null;
  } catch {
    return null;
  }
}

function remember(s: Snapshot) {
  try {
    localStorage.setItem(CACHE, JSON.stringify(s));
  } catch {
    // A full or blocked store only costs the offline copy.
  }
}

export function forget() {
  try {
    localStorage.removeItem(CACHE);
  } catch {
    // Nothing to clear.
  }
}

const numeric = <T extends { imdb: number | null }>(row: T): T => ({ ...row, imdb: row.imdb == null ? null : Number(row.imdb) });

export async function load(): Promise<Snapshot> {
  const sb = supabase!;
  const [members, runs, feedback, list] = await Promise.all([
    sb.from('members').select('household_id, user_id, display_name'),
    sb.from('watch_runs').select('id, ran_at, note').order('ran_at', { ascending: false }).limit(1),
    // '*' rather than a column list, so a database without the rating column still loads.
    sb.from('watch_feedback').select('*').order('created_at'),
    sb.from('watch_list').select('*').is('removed_at', null).order('added_at', { ascending: false })
  ]);
  // The watchlist is left out, so the picks still load before its table exists.
  for (const r of [members, runs, feedback]) if (r.error) throw r.error;

  const run = (runs.data?.[0] as Run | undefined) ?? null;
  let picks: Pick[] = [];
  if (run) {
    const res = await sb.from('watch_picks').select(PICK_COLUMNS).eq('run_id', run.id).order('rank');
    if (res.error) throw res.error;
    picks = (res.data as Pick[]).map(numeric);
  }

  const people = (members.data ?? []) as { household_id: string; user_id: string; display_name: string }[];
  const snap: Snapshot = {
    household: people[0]?.household_id ?? null,
    run,
    picks,
    feedback: (feedback.data as Feedback[]) ?? [],
    list: list.error ? [] : (list.data as ListItem[]).map(numeric),
    listReady: !list.error,
    names: Object.fromEntries(people.map((m) => [m.user_id, m.display_name]))
  };
  remember(snap);
  return snap;
}

export async function addFeedback(
  household: string,
  item: Pick | Unrated,
  reason: Reason,
  rating: number | null = null
): Promise<Feedback> {
  // rating is left out when there is none, so a database without that column still takes the tap.
  const row: Record<string, unknown> = { household_id: household, key: item.key, title: item.title, reason };
  if (rating != null) row.rating = rating;
  const { data, error } = await supabase!
    .from('watch_feedback')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data as Feedback;
}

export async function undoFeedback(id: string) {
  const { error } = await supabase!.from('watch_feedback').delete().eq('id', id);
  if (error) throw error;
}

/** The fields of a pick the watchlist keeps. */
export const fromPick = (p: Pick): NewItem => ({
  key: p.key,
  title: p.title,
  year: p.year,
  kind: p.kind,
  minutes: p.minutes,
  episodes: p.episodes,
  seasons: p.seasons,
  imdb: p.imdb,
  rt: p.rt,
  service: p.service,
  link: p.link,
  poster: p.poster
});

export async function addToList(household: string, item: NewItem): Promise<ListItem> {
  const sb = supabase!;
  const { data, error } = await sb
    .from('watch_list')
    .insert({ ...item, household_id: household })
    .select('*')
    .single();
  if (!error) return numeric(data as ListItem);
  // Already on the list (the other phone saved it), or taken off earlier: put it back on top.
  if (error.code === '23505' && item.key) {
    const res = await sb
      .from('watch_list')
      .update({ removed_at: null, added_at: new Date().toISOString() })
      .eq('key', item.key)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return numeric(res.data as ListItem);
  }
  throw error;
}

/** Takes a title off the watchlist, or puts it back (Undo). */
export async function setRemoved(id: string, removed: boolean) {
  const { error } = await supabase!
    .from('watch_list')
    .update({ removed_at: removed ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}
