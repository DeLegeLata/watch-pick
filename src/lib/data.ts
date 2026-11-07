// Reads the latest run's picks, the household's feedback and the shared
// watchlist; writes "not for us" taps and watchlist adds. The last snapshot is
// kept in localStorage so the app opens with no signal.
import { supabase } from './supabase';
import type { Feedback, ListItem, NewItem, Pick, Reason, Run, Unrated, Want } from './model';

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
    if (!s) return null;
    // A snapshot saved before the watchlist existed has no list, and one from
    // before 2026-11-07 doesn't say who wants each title.
    const list = ((s.list ?? []) as ListItem[]).map((l) => ({ ...l, wants: l.wants ?? [] }));
    return { listReady: true, names: {}, ...s, list };
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

/** A watchlist row as it loads: its wants include the ones taken off. */
type Listed = Omit<ListItem, 'wants'> & { wants: (Want & { removed_at: string | null })[] };

const listed = (row: Listed): ListItem =>
  numeric({ ...row, wants: row.wants.filter((w) => !w.removed_at).map(({ removed_at: _, ...w }) => w) });

export async function load(): Promise<Snapshot> {
  const sb = supabase!;
  const [members, runs, feedback, list] = await Promise.all([
    sb.from('members').select('household_id, user_id, display_name'),
    sb.from('watch_runs').select('id, ran_at, note').order('ran_at', { ascending: false }).limit(1),
    // '*' rather than a column list, so a database without the rating column still loads.
    sb.from('watch_feedback').select('*').order('created_at'),
    sb
      .from('watch_list')
      .select('*, wants:watch_list_wants(user_id, via, wanted_at, removed_at)')
      .is('removed_at', null)
      .order('added_at', { ascending: false })
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
    list: list.error ? [] : (list.data as Listed[]).map(listed).filter((l) => l.wants.length),
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

/**
 * Puts a title on this person's list: a saved pick, a typed name, or Me too
 * on a title already there (item.id). Returns the title's id.
 */
export async function want(household: string, item: NewItem): Promise<string> {
  const { data, error } = await supabase!.rpc('watch_list_want', { p_household: household, p_item: item });
  if (error) throw error;
  return data as string;
}

/** Takes a title off this person's list only, or puts it back (Undo). */
export async function setWanted(id: string, me: string, wanted: boolean) {
  const { error } = await supabase!
    .from('watch_list_wants')
    .update({ removed_at: wanted ? null : new Date().toISOString() })
    .eq('item_id', id)
    .eq('user_id', me);
  if (error) throw error;
}

/** How a title this phone just put on its list looks until the next load. */
export function newItem(item: NewItem, id: string, me: string): ListItem {
  const now = new Date().toISOString();
  return {
    key: null,
    typed: null,
    year: null,
    kind: null,
    minutes: null,
    episodes: null,
    seasons: null,
    imdb: null,
    rt: null,
    service: null,
    link: null,
    poster: null,
    note: null,
    source: 'app',
    added_by: me,
    added_at: now,
    ...item,
    id,
    wants: [{ user_id: me, via: 'app', wanted_at: now }]
  };
}
