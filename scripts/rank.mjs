// The ranking rules for the daily catalogue (catalogue.mjs): moods from
// genres, each person's appeal from taste.json, an IMDb score that trusts
// ratings with more votes, the slot each pick goes in, and its "why" line.
// Pure functions, tested in rank.test.ts.

export const MOODS = ['laugh', 'tense', 'mystery', 'cozy', 'scary', 'big', 'true'];

const has = (genres, ...names) => names.some((n) => genres.includes(n));

/**
 * The moods a title suits. `big` is a long, much-loved movie for a night
 * with time to spare; `true` is documentaries, true crime most of all.
 */
export function moodsFor(t) {
  const g = t.genres;
  const doc = has(g, 'Documentary');
  const out = [];
  if (has(g, 'Horror')) out.push('scary');
  if (doc) out.push('true');
  if (has(g, 'Comedy')) out.push('laugh');
  // Mystery is whodunits, crime series (procedurals) and true crime; a crime movie is tense instead.
  if (has(g, 'Mystery') || (has(g, 'Crime') && (t.kind === 'series' || doc))) out.push('mystery');
  if (
    !doc &&
    !has(g, 'Family', 'Kids', 'Animation') &&
    (has(g, 'Thriller', 'Action', 'Action & Adventure') || (has(g, 'Crime') && t.kind === 'movie'))
  )
    out.push('tense');
  if (
    has(g, 'Comedy', 'Family', 'Romance') &&
    !has(g, 'Horror', 'Thriller', 'Crime', 'Mystery', 'War', 'War & Politics', 'Documentary', 'Sci-Fi & Fantasy', 'Animation', 'Action', 'Action & Adventure')
  )
    out.push('cozy');
  if (t.kind === 'movie' && t.minutes >= 130 && t.votes >= 100_000) out.push('big');
  return out;
}

/** One person's appeal: the sum of their weights for the title's genres (unlisted genres count 0). */
export function appealFor(genres, taste, who) {
  return genres.reduce((sum, g) => sum + (taste.genres[g]?.[who] ?? 0), 0);
}

/**
 * Both of them, "average without misery": the average of the two, or null
 * when either one's appeal is below zero, which keeps it off the joint picks.
 */
export function jointAppeal(genres, taste) {
  const a = appealFor(genres, taste, 'stuart');
  const b = appealFor(genres, taste, 'sarah');
  return a < 0 || b < 0 ? null : (a + b) / 2;
}

/**
 * IMDb rating pulled toward a typical 7.0 until it has plenty of votes, so a
 * 9.1 from 6,000 votes doesn't outrank an 8.3 from 400,000.
 */
export function quality(imdb, votes, prior = 7.0, weight = 25_000) {
  return (votes * imdb + weight * prior) / (votes + weight);
}

/** Can it be a joint pick at all? Ratings floor, unwanted genres, and subtitled titles only if very popular. */
export function passes(t, taste) {
  const f = taste.floor;
  if (t.imdb == null || t.imdb < f.imdb || t.votes < f.votes) return false;
  if (!(t.minutes > 0)) return false;
  if (t.genres.some((g) => taste.exclude.includes(g))) return false;
  if (t.language && t.language !== 'en' && t.votes < f.foreignVotes) return false;
  return true;
}

export function score(t, taste, seed) {
  const joint = jointAppeal(t.genres, taste);
  if (joint == null) return null;
  return quality(t.imdb, t.votes) + taste.tasteWeight * joint + (seed ? taste.seedBoost : 0);
}

/** "Should have seen": the famous, much-loved ones. "Safe bet": squarely in their shared lanes. Else "something new". */
export function slotFor(t, taste) {
  const c = taste.canon;
  if (t.kind === 'movie' ? t.imdb >= c.movieImdb && t.votes >= c.movieVotes : t.imdb >= c.seriesImdb && t.votes >= c.seriesVotes)
    return 'canon';
  if ((jointAppeal(t.genres, taste) ?? 0) >= taste.safeAppeal && t.votes >= taste.safeVotes) return 'safe';
  return 'new';
}

const GENRE_WORD = {
  'Action & Adventure': 'action',
  'Sci-Fi & Fantasy': 'sci-fi',
  'Science Fiction': 'sci-fi',
  'War & Politics': 'politics',
  Documentary: 'documentary'
};

export function votesText(v) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${Math.round(v / 1000)}k`;
}

/** The card's one line: what it is, who'd like it, and how many people rated it. 90 characters at most. */
export function whyFor(t, seed, slot) {
  const words = t.genres
    .filter((g) => !['Drama', 'TV Movie'].includes(g) || t.genres.length === 1)
    .slice(0, 2)
    .map((g) => GENRE_WORD[g] ?? g.toLowerCase());
  const what = words.join(', ') || 'drama';
  const lead = seed ? `If you liked ${seed}` : slot === 'canon' ? 'One of the greats' : null;
  const line = [lead, what, `${votesText(t.votes)} IMDb ratings`].filter(Boolean).join(' · ');
  return line.length <= 90 ? line : line.slice(0, 89) + '…';
}

/** Lower-case words joined by hyphens: how a title is matched against SEEN.md, whatever its year. */
export const slug = (title) =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/^the /, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Everything SEEN.md lists as watched, as `movie:slug` and `series:slug`.
 * The watchlist section is skipped: those titles aren't seen.
 */
export function seenFromMarkdown(md) {
  const seen = new Set();
  let kind = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      kind = /^## Series/.test(line) ? 'series' : /^## Movies/.test(line) ? 'movie' : /^## Shared Plex/.test(line) ? 'plex' : null;
      continue;
    }
    if (kind === 'plex' && /^\*\*Shows\*\*/.test(line)) kind = 'plex-series';
    if (kind === 'plex-series' && /^\*\*Movies\*\*/.test(line)) kind = 'plex-movie';
    const k = kind === 'plex-series' ? 'series' : kind === 'plex-movie' ? 'movie' : kind === 'plex' ? null : kind;
    if (!k || !(line.startsWith('- ') || kind === 'movie')) continue;
    let text = line.replace(/^- /, '');
    // Drop parentheticals (possibly holding commas), labels like "**2025:**", "2026-11:" or "2 days:".
    while (/\([^()]*\)/.test(text)) text = text.replace(/\([^()]*\)/g, '');
    text = text.replace(/^\*\*[^*]+\*\*\s*/, '').replace(/^\d[\w -]{0,10}:\s+/, '');
    for (let part of text.split(/ · |, /)) {
      part = part.replace(/^\d[\w -]{0,10}:\s+/, '').replace(/\s*(✓|\d+%)\s*$/, '').trim();
      if (part.length > 1 && !/^Unknown show/.test(part)) seen.add(`${k}:${slug(part)}`);
    }
  }
  return seen;
}
