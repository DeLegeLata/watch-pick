// The shapes the app reads from Supabase (and the demo data uses).

/** 'rate' is not a pick: it's something the refresh saw them watch, to ask "How was it?". */
export type Slot = 'resume' | 'safe' | 'watchlist' | 'new' | 'rate';
export type Mood = 'laugh' | 'tense' | 'mystery' | 'cozy';
export type Reason = 'seen' | 'not_me' | 'not_us' | 'not_tonight' | 'someone_else';
export type Service = 'prime' | 'plex' | 'shudder';

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
  service: Service;
  link: string | null;
  poster: string | null;
  moods: Mood[];
  why: string;
  rank: number;
}

/** A title on the shared watchlist, whatever service it's on. */
export interface ListItem {
  id: string;
  /** The picks' key. Null while a typed name waits for the refresh to match it. */
  key: string | null;
  /** What someone typed on a phone. */
  typed: string | null;
  title: string;
  year: number | null;
  kind: 'movie' | 'series' | null;
  minutes: number | null;
  episodes: number | null;
  seasons: number | null;
  imdb: number | null;
  rt: number | null;
  /** Where they can watch it now; null is not on anything they have. */
  service: Service | null;
  link: string | null;
  poster: string | null;
  /** The refresh's word on it, e.g. "On Netflix". */
  note: string | null;
  /** app: added on a phone; prime / plex: pulled in from that watchlist. */
  source: 'app' | 'prime' | 'plex';
  added_by: string | null;
  added_at: string;
}

/** What a phone sends to add a title: a saved pick, or just a typed name. */
export type NewItem = Partial<ListItem> & { title: string };

export interface Feedback {
  id: string;
  user_id: string;
  key: string;
  title: string;
  reason: Reason;
  /** For 'seen': this person's verdict, 1–4 (see RATINGS); 0 is "didn't watch it"; null is not rated yet. */
  rating?: number | null;
  created_at: string;
}

/** A title someone marked seen, or the refresh saw watched, that this person hasn't rated. */
export interface Unrated {
  key: string;
  title: string;
  /** Where the refresh saw it, e.g. "Finished on Prime, Oct 31". */
  why?: string;
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

/** `resume` reasons are offered only on "pick up where you left off" cards. */
export const REASONS: { id: Reason; label: string; hint: string; resume?: boolean }[] = [
  {
    id: 'someone_else',
    label: 'Someone else watched it',
    hint: "Not us: someone else using the account. We haven't started it.",
    resume: true
  },
  { id: 'not_us', label: 'Not for us', hint: 'Neither of us wants this' },
  { id: 'not_me', label: 'Not for me', hint: 'I would not enjoy it' },
  { id: 'seen', label: "We've seen it", hint: 'Already watched it' },
  { id: 'not_tonight', label: 'Not tonight', hint: 'Hide it until tomorrow' }
];

/** How a seen title was, asked of each of them on their own phone. */
export const RATINGS: { value: number; label: string }[] = [
  { value: 4, label: 'Loved it' },
  { value: 3, label: 'Liked it' },
  { value: 2, label: 'Meh' },
  { value: 1, label: "Didn't like it" }
];

export const SERVICE_LABEL: Record<Service, string> = { prime: 'Prime Video', plex: 'On Plex', shudder: 'Shudder on Prime' };
export const OPEN_LABEL: Record<Service, string> = { prime: 'Open in Prime', plex: 'Open in Plex', shudder: 'Open in Prime' };

export const SLOT_LABEL: Record<Slot, string> = {
  resume: 'Pick up where you left off',
  safe: 'Safe bet',
  watchlist: 'From your watchlist',
  new: 'Something new',
  rate: 'How was it?'
};
