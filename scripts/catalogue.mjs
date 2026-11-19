// The daily catalogue: every title included with Prime Video in Canada (from
// TMDB, whose streaming data comes from JustWatch) and every unwatched title
// on the shared Plex server VOICEDRIVE, with IMDb's own ratings, ranked best
// first and then filtered and nudged by the two of them (rank.mjs). It
// replaces the picks the refresh used to draft by hand. The 6 am
// /watch-pick refresh runs it after it has written the day's resume, rate
// and watchlist rows.
//   node scripts/catalogue.mjs [--dry]
// --dry writes picks.json and prints the summary without sending it.
//
// .env.local needs TMDB_TOKEN (TMDB's API Read Access Token, or the v3 API key).
// Reads, in Documents\General Issues\Watching:
//   taste.json  the numbers: floor, genre weights, seeds
//   SEEN.md     what they've watched
//   picks.json  its resume, rate and watchlist rows are kept as they are
//   cache\      TMDB details, IMDb's daily ratings file, the Plex export
// The Plex export is Downloads\voicedrive-library.json, saved by
// scripts/plex-export.js in an app.plex.tv tab (Fridays).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readEnv, rpc } from './env.mjs';
import { keyFor, link, poster } from './rows.mjs';
import { MOODS, moodsFor, passes, score, seenFromMarkdown, slotFor, slug, whyFor } from './rank.mjs';

const WATCHING = join(homedir(), 'Documents', 'General Issues', 'Watching');
const CACHE = join(WATCHING, 'cache');
const PICKS = join(WATCHING, 'picks.json');
const DOWNLOADS = join(homedir(), 'Downloads');
const KEEP = ['resume', 'rate', 'watchlist'];
const today = new Date().toISOString().slice(0, 10);
const dry = process.argv.includes('--dry');
mkdirSync(CACHE, { recursive: true });

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ageDays = (iso) => (Date.now() - Date.parse(iso)) / 86_400_000;

// --- TMDB ----------------------------------------------------------------------

const token = readEnv().TMDB_TOKEN;
if (!token) throw new Error('.env.local has no TMDB_TOKEN (the API Read Access Token from themoviedb.org/settings/api).');
const bearer = token.startsWith('eyJ');

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!bearer) url.searchParams.set('api_key', token);
  const headers = { accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${token}` } : {}) };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    // The path only: the URL may carry the key.
    if (!res.ok) throw new Error(`TMDB answered ${res.status} for ${path}`);
    return res.json();
  }
}

/** Runs fn over items, n at a time. */
async function inParallel(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const providers = await tmdb('/watch/providers/movie', { watch_region: 'CA' });
const prime = providers.results.find((p) => p.provider_name === 'Amazon Prime Video');
if (!prime) throw new Error('TMDB lists no "Amazon Prime Video" provider for Canada.');

/** Every title included with Prime in Canada ("flatrate": not rentals, not paid channels). */
async function onPrime(type) {
  const ids = [];
  for (let page = 1; page <= 500; page++) {
    const d = await tmdb(`/discover/${type}`, {
      watch_region: 'CA',
      with_watch_providers: prime.provider_id,
      with_watch_monetization_types: 'flatrate',
      'vote_count.gte': 40,
      sort_by: 'vote_count.desc',
      include_adult: 'false',
      page
    });
    ids.push(...d.results.map((r) => r.id));
    if (page >= d.total_pages) break;
  }
  return ids;
}

// Details change rarely for a movie, weekly for a running series.
const DETAILS = join(CACHE, 'tmdb-details.json');
const details = readJson(DETAILS, {});

async function detail(type, id) {
  const ck = `${type}:${id}`;
  const hit = details[ck];
  if (hit && ageDays(hit.at) < (type === 'movie' ? 60 : 7)) return hit;
  const d = await tmdb(`/${type}/${id}`, type === 'tv' ? { append_to_response: 'external_ids' } : {});
  const ep = d.episode_run_time?.[0] ?? d.last_episode_to_air?.runtime ?? d.next_episode_to_air?.runtime ?? null;
  const out = {
    at: today,
    kind: type === 'movie' ? 'movie' : 'series',
    title: type === 'movie' ? d.title : d.name,
    year: Number((type === 'movie' ? d.release_date : d.first_air_date)?.slice(0, 4)) || null,
    minutes: type === 'movie' ? d.runtime || null : ep,
    episodes: type === 'tv' ? (d.number_of_episodes ?? null) : null,
    seasons: type === 'tv' ? (d.number_of_seasons ?? null) : null,
    genres: (d.genres ?? []).map((g) => g.name),
    imdbId: (type === 'movie' ? d.imdb_id : d.external_ids?.imdb_id) || null,
    language: d.original_language ?? null,
    poster: d.poster_path ?? null
  };
  details[ck] = out;
  return out;
}

// --- IMDb's ratings: one free file a day, for personal use -----------------------

async function imdbRatings(wanted) {
  const file = join(CACHE, 'title.ratings.tsv.gz');
  if (!existsSync(file) || ageDays(statSync(file).mtime.toISOString()) > 0.8) {
    const res = await fetch('https://datasets.imdbws.com/title.ratings.tsv.gz');
    if (!res.ok) throw new Error(`IMDb's ratings file answered ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const map = new Map();
  for (const line of gunzipSync(readFileSync(file)).toString('utf8').split('\n')) {
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const [, rating, votes] = line.split('\t');
    map.set(id, { imdb: Number(rating), votes: Number(votes) });
  }
  return map;
}

// --- The shared Plex server ------------------------------------------------------

/**
 * The newest voicedrive-library*.json in Downloads, copied into the cache;
 * else the cached one. Edge can leave a download from a script as
 * .json.crdownload until someone clicks Keep; its contents are complete, so
 * it counts once it parses.
 */
function plexLibrary() {
  const cached = join(CACHE, 'plex-library.json');
  let newest = null;
  try {
    for (const f of readdirSync(DOWNLOADS).filter((f) => /^voicedrive-library.*\.json(\.crdownload)?$/.test(f))) {
      const path = join(DOWNLOADS, f);
      try {
        if (!Array.isArray(JSON.parse(readFileSync(path, 'utf8')).items)) continue;
      } catch {
        continue;
      }
      if (!newest || statSync(path).mtimeMs > statSync(newest).mtimeMs) newest = path;
    }
  } catch {}
  if (newest && (!existsSync(cached) || statSync(newest).mtimeMs > statSync(cached).mtimeMs)) copyFileSync(newest, cached);
  return readJson(cached, null);
}

async function tmdbIdFor(item) {
  if (item.tmdb) return Number(item.tmdb);
  if (!item.imdb) return null;
  const ck = `find:${item.imdb}`;
  if (!(ck in details)) {
    const f = await tmdb(`/find/${item.imdb}`, { external_source: 'imdb_id' });
    details[ck] = (item.type === 'movie' ? f.movie_results : f.tv_results)?.[0]?.id ?? null;
  }
  return details[ck];
}

// --- What they've seen or turned down --------------------------------------------

const taste = readJson(join(WATCHING, 'taste.json'), null);
if (!taste) throw new Error('No taste.json in General Issues\\Watching.');
const seen = seenFromMarkdown(readFileSync(join(WATCHING, 'SEEN.md'), 'utf8'));
const taps = await rpc('watch_feedback_since', { p_since: '2026-01-01T00:00:00Z' });
const down = taps.filter((f) => ['seen', 'not_us', 'not_me', 'not_them'].includes(f.reason));
const turnedDown = new Set(down.map((f) => f.key));
// By title too, without its year or a "(US)": a tap on The Office (US) covers The Office.
const turnedDownTitles = new Set(down.map((f) => slug(f.title.replace(/\s*\([^)]*\)/g, ''))));
const isSeen = (t) =>
  seen.has(`${t.kind}:${slug(t.title)}`) || turnedDown.has(keyFor(t.title, t.year)) || turnedDownTitles.has(slug(t.title));

// --- Seeds: what TMDB's crowd recommends to fans of what they both loved ----------

const SEEDS = join(CACHE, 'seeds.json');
const seedCache = readJson(SEEDS, {});
const likeSeed = new Map();
for (const s of taste.seeds) {
  const type = s.kind === 'movie' ? 'movie' : 'tv';
  const ck = `${type}:${s.title}:${s.year}`;
  let c = seedCache[ck];
  if (!c || ageDays(c.at) > 7) {
    const found = await tmdb(`/search/${type}`, type === 'movie' ? { query: s.title, year: s.year } : { query: s.title, first_air_date_year: s.year });
    const id = found.results?.[0]?.id;
    const recs = id ? await tmdb(`/${type}/${id}/recommendations`) : { results: [] };
    c = seedCache[ck] = { at: today, id, recs: recs.results.map((r) => r.id) };
  }
  for (const r of c.recs) if (!likeSeed.has(`${type}:${r}`)) likeSeed.set(`${type}:${r}`, s.title);
}
writeFileSync(SEEDS, JSON.stringify(seedCache));

// --- Build the candidates ----------------------------------------------------------

const [movieIds, tvIds] = await Promise.all([onPrime('movie'), onPrime('tv')]);
const wantedDetails = [...movieIds.map((id) => ['movie', id]), ...tvIds.map((id) => ['tv', id])];
const plex = plexLibrary();
const plexItems = [];
if (plex) {
  await inParallel(plex.items, 8, async (item) => {
    const id = await tmdbIdFor(item).catch(() => null);
    if (id) plexItems.push({ type: item.type === 'movie' ? 'movie' : 'tv', id, plexKey: item.k });
  });
}
const all = [
  ...wantedDetails.map(([type, id]) => ({ type, id, service: 'prime' })),
  ...plexItems.map((p) => ({ ...p, service: 'plex' }))
];
let failed = 0;
const got = await inParallel(all, 8, async (c) => {
  try {
    return { ...c, ...(await detail(c.type, c.id)) };
  } catch {
    failed++;
    return null;
  }
});
writeFileSync(DETAILS, JSON.stringify(details));

// What Prime itself said (prime-check.js): "no" keeps a title off Prime for 60
// days. Rechecks: "ok" after 30 days, "maybe" and "unknown" after 14.
const CHECKS = join(CACHE, 'prime-checks.json');
const checks = readJson(CHECKS, {});
const RECHECK = { ok: 30, maybe: 14, unknown: 14, no: 60 };
const checkFor = (key) => {
  const c = checks[key];
  return c && ageDays(c.at) < RECHECK[c.status] ? c.status : null;
};
let notOnPrime = 0;

// One entry per title: Prime first (it's their own account), the server otherwise.
const byTitle = new Map();
for (const t of got.filter(Boolean)) {
  if (t.service === 'prime' && checkFor(keyFor(t.title, t.year)) === 'no') {
    notOnPrime++;
    continue;
  }
  const k = `${t.type}:${t.id}`;
  if (!byTitle.has(k) || (byTitle.get(k).service === 'plex' && t.service === 'prime')) byTitle.set(k, t);
}
const titles = [...byTitle.values()];
const ratings = await imdbRatings(new Set(titles.map((t) => t.imdbId).filter(Boolean)));

let tooLow = 0;
let seenCount = 0;
let notJoint = 0;
const ranked = [];
for (const t of titles) {
  const r = t.imdbId && ratings.get(t.imdbId);
  const full = { ...t, imdb: r?.imdb ?? null, votes: r?.votes ?? 0, minutes: Math.round(t.minutes || 0) };
  if (!passes(full, taste)) {
    tooLow++;
    continue;
  }
  if (isSeen(full)) {
    seenCount++;
    continue;
  }
  const seed = likeSeed.get(`${t.type}:${t.id}`) ?? null;
  const s = score(full, taste, seed);
  if (s == null) {
    notJoint++;
    continue;
  }
  ranked.push({ ...full, seed, score: s, moods: moodsFor(full) });
}
ranked.sort((a, b) => b.score - a.score);

// The pool: the best movies and the best series, then enough of each mood.
const chosen = new Set([
  ...ranked.filter((t) => t.kind === 'movie').slice(0, taste.pool.movies),
  ...ranked.filter((t) => t.kind === 'series').slice(0, taste.pool.series)
]);
for (const m of MOODS) {
  let have = [...chosen].filter((t) => t.moods.includes(m)).length;
  for (const t of ranked) {
    if (have >= taste.pool.moodMin) break;
    if (!chosen.has(t) && t.moods.includes(m)) {
      chosen.add(t);
      have++;
    }
  }
}

// --- picks.json: the refresh's own rows, then the catalogue ----------------------

const current = readJson(PICKS, { picks: [] });
const kept = current.picks.filter((p) => KEEP.includes(p.slot));
const keptKeys = new Set(kept.map((p) => p.key));
const ranks = {};
const fresh = [...chosen]
  .sort((a, b) => b.score - a.score)
  .map((t) => {
    const slot = slotFor(t, taste);
    return {
      key: keyFor(t.title, t.year),
      slot,
      title: t.title,
      year: t.year,
      kind: t.kind,
      minutes: t.minutes,
      episodes: t.episodes,
      seasons: t.seasons,
      imdb: t.imdb,
      rt: null,
      service: t.service,
      link: link(t.service, t.title, t.plexKey),
      poster: t.poster ? poster(`t:${t.poster.slice(1)}`) : null,
      moods: t.moods,
      why: whyFor(t, t.seed, slot),
      rank: 0
    };
  })
  .filter((p, i, arr) => !keptKeys.has(p.key) && arr.findIndex((q) => q.key === p.key) === i);
for (const p of fresh) p.rank = ranks[p.slot] = (ranks[p.slot] ?? 0) + 1;
for (const p of kept) p.rank = ranks[p.slot] = (ranks[p.slot] ?? 0) + 1;

// The Prime picks the phones will deal next (best rank first, every slot)
// that Prime itself hasn't confirmed lately: the next refresh checks these.
const ORDER = ['safe', 'watchlist', 'canon', 'new'];
const toCheck = fresh
  .filter((p) => p.service === 'prime' && !checkFor(p.key))
  .sort((a, b) => a.rank - b.rank || ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot))
  .slice(0, 40)
  .map((p) => ({ key: p.key, title: p.title, year: p.year }));
writeFileSync(join(CACHE, 'prime-to-check.json'), JSON.stringify(toCheck));

const note = `${today}: ${fresh.length} from the catalogue (Prime ${prime.provider_id}, ${plex ? `Plex export ${plex.exported?.slice(0, 10)}` : 'no Plex export'}).`;
writeFileSync(PICKS, JSON.stringify({ note, picks: [...kept, ...fresh] }, null, 1) + '\n');

// --- Summary --------------------------------------------------------------------

const count = (list, f) => list.reduce((m, p) => ((m[f(p)] = (m[f(p)] ?? 0) + 1), m), {});
console.log(`Prime CA: ${movieIds.length} movies, ${tvIds.length} series on TMDB; Plex export: ${plex ? `${plex.items.length} unwatched (${plexItems.length} matched)` : 'none'}${failed ? `; ${failed} details failed` : ''}.`);
console.log(`Kept out: ${tooLow} below the floor or unwanted genre, ${seenCount} seen or turned down, ${notJoint} one of them wouldn't like, ${notOnPrime} Prime says aren't included.`);
console.log(`Prime checks on record: ${Object.keys(checks).length}; ${toCheck.length} for the next refresh to check (cache\\prime-to-check.json).`);
console.log(`Picks: ${fresh.length} fresh + ${kept.length} kept. Slots ${JSON.stringify(count(fresh, (p) => p.slot))}. Service ${JSON.stringify(count(fresh, (p) => p.service))}.`);
console.log(`Moods: ${MOODS.map((m) => `${m} ${fresh.filter((p) => p.moods.includes(m)).length}`).join(', ')}.`);
console.log('Top 15:');
for (const p of fresh.slice(0, 15)) console.log(`  ${p.slot.padEnd(5)} ${p.title} (${p.year}, ${p.kind}, ${p.minutes} min) IMDb ${p.imdb} | ${p.moods.join(',')} | ${p.why}`);

if (!dry) execFileSync(process.execPath, [fileURLToPath(new URL('./push-picks.mjs', import.meta.url)), PICKS], { stdio: 'inherit' });
