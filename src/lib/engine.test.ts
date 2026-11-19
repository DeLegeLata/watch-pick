import { describe, expect, it } from 'vitest';
import { ago, chooseTonight, daySeed, fits, hiddenKeys, inView, listMeta, markShown, otherName, recentKeys, runtimeLabel, shownList, toRate, wantLabel } from './engine';
import type { Feedback, ListItem, Pick, Want, Whose } from './model';

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

describe('toRate', () => {
  const seen = (key: string, user_id: string, rating: number | null = null): Feedback => ({
    ...fb(key, 'seen', '2026-11-01T12:00:00Z'),
    id: `${key}${user_id}${rating}`,
    user_id,
    rating
  });
  it("asks each person about anything either of them marked seen, until they've rated it", () => {
    const rows = [seen('a', 'stu', 4), seen('b', 'stu'), fb('c', 'not_me', '2026-11-01T12:00:00Z')];
    expect(toRate(rows, 'stu').map((u) => u.key)).toEqual(['b']);
    expect(toRate(rows, 'sarah').map((u) => u.key)).toEqual(['a', 'b']);
  });
  it('counts "didn\'t watch it" (0) as answered', () => {
    expect(toRate([seen('a', 'stu', 3), seen('a', 'sarah', 0)], 'sarah')).toEqual([]);
  });
  it('also asks about what the refresh saw watched, after the seen taps', () => {
    const watched = [pick({ title: 'w', slot: 'rate', why: 'Finished on Prime' }), pick({ title: 's', slot: 'safe' })];
    expect(toRate([seen('b', 'stu')], 'sarah', watched)).toEqual([
      { key: 'b', title: 'b' },
      { key: 'w', title: 'w', why: 'Finished on Prime' }
    ]);
    expect(toRate([seen('w', 'sarah', 4)], 'sarah', watched)).toEqual([]);
  });
  it('never deals a rate entry as a pick', () => {
    const t = chooseTonight([pick({ title: 'w', slot: 'rate' })], new Set(), Infinity, 'any');
    expect(t.cards).toEqual([]);
  });
});

describe('daySeed', () => {
  it('holds for a day and changes the next', () => {
    const morning = daySeed(new Date(2026, 10, 2, 7, 0));
    expect(daySeed(new Date(2026, 10, 2, 23, 0))).toBe(morning);
    expect(daySeed(new Date(2026, 10, 3, 7, 0))).not.toBe(morning);
    expect(morning).not.toBe(0);
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

  it('steps through the resume cards with the pages, most recent first', () => {
    const two = [...picks, pick({ title: 'resume2', slot: 'resume', minutes: 30, rank: 2 })];
    expect(chooseTonight(two, new Set(), 90, 'any', 0, 7).resume?.title).toBe('resume');
    expect(chooseTonight(two, new Set(), 90, 'any', 1, 7).resume?.title).toBe('resume2');
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

const item = (over: Partial<ListItem>): ListItem => ({
  id: over.title ?? 'x',
  key: over.title ?? 'x',
  typed: null,
  title: 'x',
  year: 2020,
  kind: 'movie',
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
  added_by: 'me',
  added_at: '2026-11-01T17:00:00Z',
  wants: [],
  ...over
});

const want = (user_id: string, via: Want['via'] = 'app', wanted_at = '2026-11-01T17:00:00Z'): Want => ({
  user_id,
  via,
  wanted_at
});

describe('the shared watchlist', () => {
  it('shows the most recently wanted first and drops what either of them saw', () => {
    const list = [
      item({ title: 'old', added_at: '2026-10-01T17:00:00Z' }),
      item({ title: 'new', added_at: '2026-11-02T17:00:00Z' }),
      item({ title: 'seen' }),
      item({
        title: 'now both',
        added_at: '2026-09-01T17:00:00Z',
        wants: [want('me', 'prime', '2026-09-01T17:00:00Z'), want('her', 'app', '2026-11-03T17:00:00Z')]
      })
    ];
    expect(shownList(list, [fb('seen', 'seen', '2026-11-02T20:00:00Z')]).map((l) => l.title)).toEqual([
      'now both',
      'new',
      'old'
    ]);
  });
  it('splits the list into Mine, theirs and Both', () => {
    const list = [
      item({ title: 'mine', wants: [want('me')] }),
      item({ title: 'hers', wants: [want('her')] }),
      item({ title: 'both', wants: [want('me'), want('her')] })
    ];
    const titles = (view: Whose) => list.filter((l) => inView(l, 'me', view)).map((l) => l.title);
    expect(titles('both')).toEqual(['both']);
    expect(titles('mine')).toEqual(['mine', 'both']);
    expect(titles('theirs')).toEqual(['hers', 'both']);
    expect(titles('all')).toHaveLength(3);
    expect(otherName({ me: 'Stuart', her: 'Sarah' }, 'me')).toBe('Sarah');
  });
  it('keeps a typed name with no key, and can keep only what they can watch', () => {
    const list = [item({ title: 'typed', key: null }), item({ title: 'prime', service: 'prime' })];
    expect(shownList(list, [fb('x', 'seen', '2026-11-02T20:00:00Z')])).toHaveLength(2);
    expect(shownList(list, [], true).map((l) => l.title)).toEqual(['prime']);
  });
  it('shows runtime and ratings only once the refresh has them', () => {
    expect(listMeta(item({ key: null }))).toBe('');
    expect(listMeta(item({ kind: 'series', minutes: 47, imdb: 7.5 }))).toBe('47-min episodes · IMDb 7.5');
  });
  it('says who wants it, and whose watchlist it came from', () => {
    const names = { me: 'Stuart', her: 'Sarah' };
    const label = (...wants: Want[]) => wantLabel(item({ wants }), 'me', names);
    expect(label(want('me'))).toBe('Added by you, Nov 1');
    expect(label(want('her'))).toBe('Added by Sarah, Nov 1');
    expect(label(want('me', 'prime'))).toBe('From your Prime watchlist');
    expect(label(want('her', 'prime'))).toBe("From Sarah's Prime watchlist");
    expect(label(want('me', 'plex'))).toBe('From the Plex watchlist');
    expect(label(want('me'), want('her', 'prime'))).toBe('You both want this');
  });
});

describe('no repeats for two weeks', () => {
  const now = new Date(2026, 10, 18, 20);
  const picks = [
    pick({ title: 's1', slot: 'safe', rank: 1 }),
    pick({ title: 's2', slot: 'safe', rank: 2 }),
    pick({ title: 'c1', slot: 'canon', rank: 1 }),
    pick({ title: 'c2', slot: 'canon', rank: 2 }),
    pick({ title: 'n1', slot: 'new', rank: 1 }),
    pick({ title: 'n2', slot: 'new', rank: 2 })
  ];

  it('deals best first, one per slot', () => {
    expect(chooseTonight(picks, new Set(), 90, 'any').cards.map((c) => c.title)).toEqual(['s1', 'c1', 'n1']);
  });

  it('moves cards shown on an earlier day to the back', () => {
    const shown = { s1: '2026-11-17', c1: '2026-11-17', n1: '2026-11-10' };
    const recent = recentKeys(shown, now);
    expect(chooseTonight(picks, new Set(), 90, 'any', 0, 0, recent).cards.map((c) => c.title)).toEqual(['s2', 'c2', 'n2']);
  });

  it("keeps today's cards where they are, and forgets after 14 days", () => {
    expect([...recentKeys({ a: '2026-11-18', b: '2026-11-17', c: '2026-11-03' }, now)]).toEqual(['b']);
  });

  it('records shown cards once a day and drops old ones', () => {
    const next = markShown({ old: '2026-10-01', b: '2026-11-17' }, ['b', 'c'], now);
    expect(next).toEqual({ b: '2026-11-18', c: '2026-11-18' });
    expect(markShown(next!, ['b', 'c'], now)).toBeNull();
  });
});
