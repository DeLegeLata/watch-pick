// Reads the latest run's picks and the household's feedback, and writes
// "not for us" taps. The last snapshot is kept in localStorage so the app
// opens with no signal.
import { supabase } from './supabase';
import type { Feedback, Pick, Reason, Run } from './model';

export interface Snapshot {
  household: string | null;
  run: Run | null;
  picks: Pick[];
  feedback: Feedback[];
}

const CACHE = 'watch-pick:snapshot';
const PICK_COLUMNS =
  'key, slot, title, year, kind, minutes, episodes, seasons, imdb, rt, service, link, poster, moods, why, rank';

export function cached(): Snapshot | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? 'null');
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

export async function load(): Promise<Snapshot> {
  const sb = supabase!;
  const [member, runs, feedback] = await Promise.all([
    sb.from('members').select('household_id').limit(1).maybeSingle(),
    sb.from('watch_runs').select('id, ran_at, note').order('ran_at', { ascending: false }).limit(1),
    sb.from('watch_feedback').select('id, user_id, key, title, reason, created_at').order('created_at')
  ]);
  for (const r of [member, runs, feedback]) if (r.error) throw r.error;

  const run = (runs.data?.[0] as Run | undefined) ?? null;
  let picks: Pick[] = [];
  if (run) {
    const res = await sb.from('watch_picks').select(PICK_COLUMNS).eq('run_id', run.id).order('rank');
    if (res.error) throw res.error;
    picks = (res.data as Pick[]).map((p) => ({ ...p, imdb: p.imdb == null ? null : Number(p.imdb) }));
  }

  const snap: Snapshot = {
    household: (member.data?.household_id as string | undefined) ?? null,
    run,
    picks,
    feedback: (feedback.data as Feedback[]) ?? []
  };
  remember(snap);
  return snap;
}

export async function addFeedback(household: string, pick: Pick, reason: Reason): Promise<Feedback> {
  const { data, error } = await supabase!
    .from('watch_feedback')
    .insert({ household_id: household, key: pick.key, title: pick.title, reason })
    .select('id, user_id, key, title, reason, created_at')
    .single();
  if (error) throw error;
  return data as Feedback;
}

export async function undoFeedback(id: string) {
  const { error } = await supabase!.from('watch_feedback').delete().eq('id', id);
  if (error) throw error;
}
