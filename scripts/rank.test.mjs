import { describe, expect, it } from 'vitest';
import { jointAppeal, moodsFor, passes, quality, seenFromMarkdown, slotFor, slug, whyFor } from './rank.mjs';

// The shape of Watching\taste.json, which lives on the home PC, not in this repo.
const taste = {
  floor: { imdb: 7.0, votes: 5000, foreignVotes: 300000 },
  tasteWeight: 0.12,
  seedBoost: 0.25,
  safeAppeal: 1.5,
  safeVotes: 30000,
  canon: { movieImdb: 8.0, movieVotes: 300000, seriesImdb: 8.5, seriesVotes: 150000 },
  exclude: ['Kids', 'Reality', 'Talk', 'News', 'Soap'],
  genres: {
    Crime: { stuart: 2, sarah: 2 },
    Mystery: { stuart: 2, sarah: 2 },
    Comedy: { stuart: 1, sarah: 1 },
    Thriller: { stuart: 1, sarah: 1 },
    Drama: { stuart: -0.5, sarah: 0.5 },
    Romance: { stuart: -2, sarah: 1 },
    Action: { stuart: 1, sarah: -1 },
    War: { stuart: 1, sarah: -3 }
  }
};
const title = (over) => ({ kind: 'movie', title: 'X', year: 2020, minutes: 100, genres: ['Crime'], imdb: 7.5, votes: 50_000, language: 'en', ...over });

describe('the floor', () => {
  it('keeps IMDb 7.0+ with 5,000+ votes', () => {
    expect(passes(title({ imdb: 7.0, votes: 5000 }), taste)).toBe(true);
    expect(passes(title({ imdb: 6.9 }), taste)).toBe(false);
    expect(passes(title({ votes: 4999 }), taste)).toBe(false);
  });
  it('wants far more votes for a subtitled title', () => {
    expect(passes(title({ language: 'hi', votes: 60_000 }), taste)).toBe(false);
    expect(passes(title({ language: 'ko', votes: 900_000 }), taste)).toBe(true);
  });
  it('never takes a language they ruled out, however popular', () => {
    expect(passes(title({ language: 'pa', votes: 2_000_000 }), { ...taste, excludeLanguages: ['pa'] })).toBe(false);
  });
  it('drops reality, kids and talk shows', () => {
    expect(passes(title({ kind: 'series', genres: ['Reality'] }), taste)).toBe(false);
  });
});

describe('both of them', () => {
  it('keeps crime for both and drops what one of them would dislike', () => {
    expect(jointAppeal(['Crime', 'Drama'], taste)).toBeGreaterThan(1);
    expect(jointAppeal(['War', 'Drama'], taste)).toBeNull();
    expect(jointAppeal(['Romance', 'Drama'], taste)).toBeNull();
    expect(jointAppeal(['Action'], taste)).toBeNull();
  });
  it('trusts a rating more as its votes grow', () => {
    expect(quality(8.3, 400_000)).toBeGreaterThan(quality(9.1, 6000));
  });
});

describe('moods and slots', () => {
  it('reads moods from genres', () => {
    expect(moodsFor(title({ genres: ['Horror', 'Comedy'] }))).toEqual(['scary', 'laugh']);
    expect(moodsFor(title({ genres: ['Documentary', 'Crime'] }))).toEqual(['true', 'mystery']);
    expect(moodsFor(title({ genres: ['Comedy', 'Family'] }))).toContain('cozy');
    expect(moodsFor(title({ minutes: 160, votes: 800_000, genres: ['Drama'] }))).toEqual(['big']);
    expect(moodsFor(title({ kind: 'series', minutes: 160, votes: 800_000, genres: ['Drama'] }))).toEqual([]);
    expect(moodsFor(title({ genres: ['Drama', 'Crime'] }))).toEqual(['tense']);
    expect(moodsFor(title({ kind: 'series', genres: ['Drama', 'Crime'] }))).toEqual(['mystery']);
    expect(moodsFor(title({ kind: 'series', genres: ['Animation', 'Comedy'] }))).toEqual(['laugh']);
  });
  it('puts the famous ones in "should have seen"', () => {
    expect(slotFor(title({ imdb: 8.6, votes: 1_500_000 }), taste)).toBe('canon');
    expect(slotFor(title({ genres: ['Crime', 'Mystery'] }), taste)).toBe('safe');
    expect(slotFor(title({ genres: ['Comedy'] }), taste)).toBe('new');
  });
  it('writes a short why', () => {
    expect(whyFor(title({ genres: ['Crime', 'Thriller'], votes: 412_000 }), 'Fargo', 'safe')).toBe('If you liked Fargo · crime, thriller · 412k IMDb ratings');
    expect(whyFor(title({ genres: ['Drama'], votes: 2_100_000 }), null, 'canon')).toBe('One of the greats · drama · 2.1M IMDb ratings');
  });
});

describe('SEEN.md', () => {
  const md = `# Already seen
## Series (days, seasons, when)
- The X-Files (116 days, S1–8, 2020-07 → 2026-02)
- Bosch (35, S1–7, 2022) · Bosch: Legacy (9, S1, 2022)
- 2 days: Sterling Point, Top Gear (UK), Olive Kitteridge
## Movies seen more than once
Fargo (5) · The Big Lebowski (3) · 2 each: The Bridge at Remagen, Dumb and Dumber
## Movies, by year watched
- **2026:** Good Time (Nov 11, STARZ channel, finished), Halloween 4, Mission: Impossible
## Watchlist (cleaned 2026-11-01: only titles they can watch)
- **Included with Prime:** Blade Runner, Constantine
## Shared Plex account "ianrgo" on server VOICEDRIVE (read 2026-11-01)
**Not all of this is theirs:** the account is shared.
**Shows** (episodes watched, seasons):
- 2026-11: The Killing (US) (S2 E9–E11 finished, S2 E12 18 min) · Industry (S1 E1, 13 min, Nov 10)
**Movies** (✓ finished, otherwise how far in):
- 2026: The Housemaid ✓, Coyote vs. Acme 41%
`;
  const seen = seenFromMarkdown(md);
  it('reads series, movies and the Plex history', () => {
    for (const k of ['series:x-files', 'series:bosch', 'series:bosch-legacy', 'series:olive-kitteridge', 'series:top-gear', 'series:killing', 'series:industry'])
      expect(seen.has(k), k).toBe(true);
    for (const k of ['movie:fargo', 'movie:big-lebowski', 'movie:bridge-at-remagen', 'movie:good-time', 'movie:halloween-4', 'movie:mission-impossible', 'movie:housemaid', 'movie:coyote-vs-acme'])
      expect(seen.has(k), k).toBe(true);
  });
  it('skips the watchlist, which is unwatched', () => {
    expect(seen.has('movie:blade-runner')).toBe(false);
    expect(seen.has(`movie:${slug('Constantine')}`)).toBe(false);
  });
});
