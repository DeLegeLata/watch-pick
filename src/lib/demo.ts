// Sample picks for ?demo, from the first test run on 2026-11-01. They let the
// app be seen before Supabase is set up; taps in demo mode stay in memory.
import type { Pick, Run } from './model';

export const demoRun: Run = { id: 'demo', ran_at: '2026-11-01T17:00:00Z', note: 'Demo picks' };

const prime = (title: string) => `https://www.primevideo.com/search?phrase=${encodeURIComponent(title)}`;

export const demoPicks: Pick[] = [
  {
    key: 'halloween-4-1988', slot: 'resume', title: 'Halloween 4: The Return of Michael Myers', year: 1988,
    kind: 'movie', minutes: 48, episodes: null, seasons: null, imdb: null, rt: null, service: 'prime',
    link: prime('Halloween 4'), poster: null, moods: ['tense'],
    why: 'Stopped at 45% last time.', rank: 0
  },
  {
    key: 'deep-cover-2025', slot: 'safe', title: 'Deep Cover', year: 2025, kind: 'movie', minutes: 100,
    episodes: null, seasons: null, imdb: 6.7, rt: null, service: 'prime', link: prime('Deep Cover'),
    poster: null, moods: ['laugh'], why: 'British improv-comedy cop caper: Hot Fuzz meets Friendship.', rank: 1
  },
  {
    key: 'young-sherlock-2026', slot: 'watchlist', title: 'Young Sherlock', year: 2026, kind: 'series',
    minutes: 53, episodes: null, seasons: 1, imdb: 7.5, rt: null, service: 'prime', link: prime('Young Sherlock'),
    poster: null, moods: ['mystery'], why: 'On the watchlist: a playful, case-driven mystery.', rank: 1
  },
  {
    key: 'deadloch-2023', slot: 'new', title: 'Deadloch', year: 2023, kind: 'series', minutes: 47,
    episodes: 14, seasons: 2, imdb: 7.5, rt: 100, service: 'prime', link: prime('Deadloch'),
    poster: 'https://image.tmdb.org/t/p/w342/7rI7T4AfSzOx0Rqw73AusyIpeXf.jpg', moods: ['laugh', 'mystery'],
    why: 'Killing Eve meets Fargo: a female-led murder mystery that is also very funny.', rank: 1
  },
  {
    key: 'ballard-2025', slot: 'safe', title: 'Ballard', year: 2025, kind: 'series', minutes: 45, episodes: 10,
    seasons: null, imdb: 7.5, rt: 100, service: 'prime', link: prime('Ballard'), poster: null, moods: ['mystery'],
    why: 'A Bosch spin-off: an LAPD cold-case unit.', rank: 2
  },
  {
    key: 'my-old-ass-2024', slot: 'new', title: 'My Old Ass', year: 2024, kind: 'movie', minutes: 89, episodes: null,
    seasons: null, imdb: 6.9, rt: 90, service: 'prime', link: prime('My Old Ass'), poster: null, moods: ['laugh', 'cozy'],
    why: 'Funny, sweet coming-of-age with Aubrey Plaza.', rank: 2
  },
  {
    key: 'heat-1995', slot: 'new', title: 'Heat', year: 1995, kind: 'movie', minutes: 170, episodes: null,
    seasons: null, imdb: 8.3, rt: 88, service: 'plex', link: null, poster: null, moods: ['tense'],
    why: 'Sample of a pick from the shared Plex server.', rank: 3
  }
];
