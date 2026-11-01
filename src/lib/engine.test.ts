import { describe, expect, it } from 'vitest';
import { ago, chooseTonight, fits, hiddenKeys, runtimeLabel } from './engine';
import type { Feedback, Pick } from './model';

const pick = (over: Partial<Pick>): Pick => ({
  key: over.title ?? 'x',
  slot: 'safe',
  title: 'x',
  year: 2020,
  kind: 'movie',
  minutes: 100,
  episodes: null,
  seasons: null,
  imdb: 7,
  rt: 90,
  service: 'prime',
  link: null,
  poster: null,
  moods: [],
  why: '',
  rank: 0,
  ...over
});

const fb = (key: string, reason: Feedback['reason'], created_at: string): Feedback => ({
  id: key + reason,
  user_id: 'u',
  key,
  title: key,
  reason,
  created_at
});

describe('fits', () => {
  it('lets a movie run 10 minutes past the window', () => {
    expect(fits(pick({ minutes: 100 }), 90)).toBe(true);
    expect(fits(pick({ minutes: 101 }), 90)).toBe(false);
  });
  it('needs a series episode to fit inside the window', () => {
    expect(fits(pick({ kind: 'series', minutes: 47 }), 45)).toBe(false);
    expect(fits(pick({ kind: 'series', minutes: 45 }), 45)).toBe(true);
  });
  it('treats 2 h + as no limit', () => {
    expect(fits(pick({ minutes: 190 }), Infinity)).toBe(true);
  });
});

describe('hiddenKeys', () => {
  const now = new Date(2026, 10, 6, 21, 0);
  it('hides seen and not-for-us titles for good', () => {
    const h = hiddenKeys([fb('a', 'seen', '2026-10-01T12:00:00Z'), fb('b', 'not_me', '2026-10-01T12:00:00Z')], now);
    expect([...h].sort()).toEqual(['a', 'b']);
  });
  it('hides not-tonight titles only on the same local date', () => {
    const today = new Date(2026, 10, 6, 20, 30).toISOString();
    const yesterday = new Date(2026, 10, 5, 22, 0).toISOString();
    const h = hiddenKeys([fb('a', 'not_tonight', today), fb('b', 'not_tonight', yesterday)], now);
    expect([...h]).toEqual(['a']);
  });
});

describe('chooseTonight', () => {
  const picks = [
    pick({ title: 'resume', slot: 'resume', minutes: 48 }),
    pick({ title: 's1', slot: 'safe', rank: 1, moods: ['laugh'] }),
    pick({ title: 's2', slot: 'safe', rank: 2 }),
    pick({ title: 'w1', slot: 'watchlist', kind: 'series', minutes: 53, moods: ['mystery'] }),
    pick({ title: 'n1', slot: 'new', kind: 'series', minutes: 47, moods: ['laugh', 'mystery'] }),
    pick({ title: 'long', slot: 'new', minutes: 150 })
  ];

  it('gives one card per slot, best rank first, and the resume card', () => {
    const t = chooseTonight(picks, new Set(), 90, 'any');
    expect(t.resume?.title).toBe('resume');
    expect(t.cards.map((c) => c.title)).toEqual(['s1', 'w1', 'n1']);
    expect(t.cards.map((c) => c.title)).not.toContain('long');
  });

  it('puts mood matches first and tops up when there are too few', () => {
    const t = chooseTonight(picks, new Set(), 90, 'laugh');
    expect(t.cards.map((c) => c.title)).toEqual(['s1', 'n1', 's2']);
    expect(t.topped).toBe(true);
  });

  it('skips hidden titles and cycles pages', () => {
    const t = chooseTonight(picks, new Set(['s1']), 90, 'any');
    expect(t.cards.map((c) => c.title)).toEqual(['s2', 'w1', 'n1']);
    const p2 = chooseTonight(picks, new Set(), Infinity, 'any', 1);
    expect(p2.cards.map((c) => c.title)).toEqual(['s2', 'long']);
  });

  const many = (['safe', 'watchlist', 'new'] as const).flatMap((slot) =>
    [1, 2, 3, 4].map((rank) => pick({ title: `${slot}${rank}`, slot, rank }))
  );
  const every = (seed: number) =>
    [0, 1, 2, 3].flatMap((p) => chooseTonight(many, new Set(), 90, 'any', p, seed).cards.map((c) => c.title)).sort();

  it('shuffles the same way for the same seed, and still deals every pick once', () => {
    const a = chooseTonight(many, new Set(), 90, 'any', 0, 42).cards;
    expect(chooseTonight(many, new Set(), 90, 'any', 0, 42).cards).toEqual(a);
    expect(every(42)).toEqual(every(0));
    expect(new Set(every(42)).size).toBe(12);
  });

  it('gives a different first three for some shuffle, and keeps a mix of slots', () => {
    const ranked = chooseTonight(many, new Set(), 90, 'any').cards.map((c) => c.title);
    expect(ranked).toEqual(['safe1', 'watchlist1', 'new1']);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const firsts = seeds.map((s) => chooseTonight(many, new Set(), 90, 'any', 0, s).cards);
    expect(firsts.some((cards) => cards.map((c) => c.title).join() !== ranked.join())).toBe(true);
    for (const cards of firsts) expect(cards.map((c) => c.slot)).toEqual(['safe', 'watchlist', 'new']);
  });

  it('drops a resume card that does not fit or match the mood', () => {
    expect(chooseTonight(picks, new Set(), 45, 'any').resume?.title).toBe('resume');
    expect(chooseTonight(picks, new Set(), 90, 'laugh').resume).toBeNull();
  });
});

describe('labels', () => {
  it('describes runtimes', () => {
    expect(runtimeLabel(pick({ minutes: 100 }))).toBe('1 h 40');
    expect(runtimeLabel(pick({ kind: 'series', minutes: 47, episodes: 14 }))).toBe('47-min episodes · 14 episodes');
    expect(runtimeLabel(pick({ slot: 'resume', minutes: 48 }))).toBe('48 min left');
  });
  it('says how long ago the refresh was', () => {
    const now = new Date(2026, 10, 8, 20, 0);
    expect(ago(new Date(2026, 10, 8, 9, 0).toISOString(), now)).toBe('today');
    expect(ago(new Date(2026, 10, 6, 16, 0).toISOString(), now)).toBe('2 days ago');
  });
});
