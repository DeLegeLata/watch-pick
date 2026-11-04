// Chooses tonight's cards from the week's picks. Pure functions, tested in
// engine.test.ts.

import type { Feedback, ListItem, Mood, Pick, Slot, Unrated } from './model';

/** A movie may run 10 minutes past the window; nobody minds the credits. */
export const MOVIE_GRACE = 10;

export function fits(pick: Pick, windowMinutes: number): boolean {
  if (pick.kind === 'series' && pick.slot !== 'resume') return pick.minutes <= windowMinutes;
  return pick.minutes <= windowMinutes + MOVIE_GRACE;
}

/** The local calendar date, so "Not tonight" lasts until the next morning's date. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Titles to hide. Any "seen", "not for me" or "not for us" from either phone
 * hides a title for both, because every pick is meant for the two of them.
 * "Not tonight" hides it only on the day it was tapped.
 */
export function hiddenKeys(feedback: Feedback[], now: Date): Set<string> {
  const today = localDate(now);
  const hidden = new Set<string>();
  for (const f of feedback) {
    if (f.reason !== 'not_tonight' || localDate(new Date(f.created_at)) === today) hidden.add(f.key);
  }
  return hidden;
}

/**
 * Titles `me` hasn't rated yet: first anything either of them marked seen
 * (a "seen" tap from one phone asks both people, since each rates for
 * themselves), then what the refresh saw them watch (the 'rate' slot).
 */
export function toRate(feedback: Feedback[], me: string, picks: Pick[] = []): Unrated[] {
  const rated = new Set(
    feedback.filter((f) => f.reason === 'seen' && f.user_id === me && f.rating != null).map((f) => f.key)
  );
  const out = new Map<string, Unrated>();
  for (const f of feedback) {
    if (f.reason === 'seen' && !rated.has(f.key) && !out.has(f.key)) out.set(f.key, { key: f.key, title: f.title });
  }
  for (const p of picks) {
    if (p.slot === 'rate' && !rated.has(p.key) && !out.has(p.key)) out.set(p.key, { key: p.key, title: p.title, why: p.why });
  }
  return [...out.values()];
}

/** A non-zero seed that changes at local midnight, so the app deals a fresh three each day. */
export function daySeed(now: Date): number {
  let h = 2166136261;
  for (const ch of localDate(now)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0 || 1;
}

export interface Tonight {
  resume: Pick | null;
  cards: Pick[];
  /** True when the mood had too few matches and other picks filled the gaps. */
  topped: boolean;
  /** How many more fitting picks "Show three others" can cycle through. */
  more: number;
}

const ORDER: Slot[] = ['safe', 'watchlist', 'new'];

/** A small seeded random generator (mulberry32), so a shuffle holds still while you look at it. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tonight's resume card and three cards. Each card prefers its own slot (safe
 * bet, watchlist, something new); mood matches come first; `page` cycles to
 * the next three. A non-zero `seed` shuffles each slot instead of using the
 * refresh's ranking. The resume card goes by rank (the most recently watched
 * first), and `page` steps through the others.
 */
export function chooseTonight(
  picks: Pick[],
  hidden: Set<string>,
  windowMinutes: number,
  mood: Mood | 'any',
  page = 0,
  seed = 0
): Tonight {
  const open = picks.filter((p) => !hidden.has(p.key) && fits(p, windowMinutes));
  const byRank = (a: Pick, b: Pick) => a.rank - b.rank;
  const matches = (p: Pick) => mood === 'any' || p.moods.includes(mood);

  const resumes = open.filter((p) => p.slot === 'resume' && matches(p)).sort(byRank);
  const resume = resumes.length ? resumes[page % resumes.length] : null;

  const rest = open.filter((p) => p.slot !== 'resume');
  const good = rest.filter(matches);
  const other = rest.filter((p) => !matches(p));

  // Deal the mood matches round-robin by slot, so each set of three mixes the
  // slots, then the rest after them.
  const order = (list: Pick[], salt: number) => {
    const out = [...list].sort(byRank);
    if (!seed) return out;
    const rand = seeded(seed + salt * 7919);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const deal = (list: Pick[]) => {
    const queues = ORDER.map((s, i) => order(list.filter((p) => p.slot === s), i));
    const out: Pick[] = [];
    while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
    return out;
  };
  const sequence = [...deal(good), ...deal(other)];

  const sets = Math.max(1, Math.ceil(sequence.length / 3));
  const start = (page % sets) * 3;
  const cards = sequence.slice(start, start + 3);
  const topped = cards.some((c) => !matches(c));
  return { resume, cards, topped, more: Math.max(0, sequence.length - 3) };
}

export function runtimeLabel(p: Pick): string {
  if (p.slot === 'resume') return `${duration(p.minutes)} left`;
  if (p.kind === 'series') {
    const eps = p.episodes ? ` · ${p.episodes} episodes` : '';
    return `${p.minutes}-min episodes${eps}`;
  }
  return duration(p.minutes);
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

export function ratingLabel(p: { imdb: number | null; rt: number | null }): string {
  const parts: string[] = [];
  if (p.imdb != null) parts.push(`IMDb ${p.imdb.toFixed(1)}`);
  if (p.rt != null) parts.push(`RT ${p.rt}%`);
  return parts.join(' · ');
}

/**
 * The shared watchlist as the phones show it: newest first, without anything
 * either of them marked seen. `onlyWatchable` keeps what's on Prime, Plex or
 * Shudder now.
 */
export function shownList(list: ListItem[], feedback: Feedback[], onlyWatchable = false): ListItem[] {
  const seen = new Set(feedback.filter((f) => f.reason === 'seen').map((f) => f.key));
  return list
    .filter((l) => !(l.key && seen.has(l.key)) && (!onlyWatchable || l.service))
    .sort((a, b) => b.added_at.localeCompare(a.added_at));
}

/** Runtime and ratings for a watchlist row; a typed name not matched yet has neither. */
export function listMeta(l: ListItem): string {
  const run = l.minutes == null ? '' : l.kind === 'series' ? `${l.minutes}-min episodes` : duration(l.minutes);
  return [run, ratingLabel(l)].filter(Boolean).join(' · ');
}

/** "Added by Sarah, Nov 3", or where an imported title came from. */
export function addedLabel(l: ListItem, me: string, names: Record<string, string>): string {
  if (l.source === 'prime') return "From Prime's watchlist";
  if (l.source === 'plex') return 'From the Plex watchlist';
  const day = new Date(l.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const who = l.added_by === me ? 'you' : l.added_by ? names[l.added_by] : undefined;
  return who ? `Added by ${who}, ${day}` : `Added ${day}`;
}

/** "today", "yesterday", or "5 days ago", for the refresh date. */
export function ago(iso: string, now: Date): string {
  const days = Math.round((Date.parse(localDate(now)) - Date.parse(localDate(new Date(iso)))) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
