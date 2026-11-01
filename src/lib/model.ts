// The shapes the app reads from Supabase (and the demo data uses).

export type Slot = 'resume' | 'safe' | 'watchlist' | 'new';
export type Mood = 'laugh' | 'tense' | 'mystery' | 'cozy';
export type Reason = 'seen' | 'not_me' | 'not_us' | 'not_tonight';

export interface Pick {
  key: string;
  slot: Slot;
  title: string;
  year: number | null;
  kind: 'movie' | 'series';
  /** A movie's runtime, a series' episode length, or for 'resume' the minutes left. */
  minutes: number;
  episodes: number | null;
  seasons: number | null;
  imdb: number | null;
  rt: number | null;
  service: 'prime' | 'plex' | 'shudder';
  link: string | null;
  poster: string | null;
  moods: Mood[];
  why: string;
  rank: number;
}

export interface Feedback {
  id: string;
  user_id: string;
  key: string;
  title: string;
  reason: Reason;
  created_at: string;
}

export interface Run {
  id: string;
  ran_at: string;
  note: string | null;
}

export const MOODS: { id: Mood | 'any'; label: string }[] = [
  { id: 'any', label: 'Anything' },
  { id: 'laugh', label: 'A laugh' },
  { id: 'tense', label: 'Tense' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'cozy', label: 'Cozy' }
];

/** Minutes they have; Infinity is "2 h or more". */
export const WINDOWS: { minutes: number; label: string }[] = [
  { minutes: 45, label: '45 min' },
  { minutes: 90, label: '1½ h' },
  { minutes: Infinity, label: '2 h +' }
];

export const REASONS: { id: Reason; label: string; hint: string }[] = [
  { id: 'not_us', label: 'Not for us', hint: 'Neither of us wants this' },
  { id: 'not_me', label: 'Not for me', hint: 'I would not enjoy it' },
  { id: 'seen', label: "We've seen it", hint: 'Already watched it' },
  { id: 'not_tonight', label: 'Not tonight', hint: 'Hide it until tomorrow' }
];

export const SLOT_LABEL: Record<Slot, string> = {
  resume: 'Pick up where you left off',
  safe: 'Safe bet',
  watchlist: 'From your watchlist',
  new: 'Something new'
};
