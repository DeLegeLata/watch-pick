// Updates picks.json from a pipe-separated rows file, so a refresh only has to
// write the new picks, not the whole JSON.
//   node scripts/build-picks.mjs <rows.txt> [--drop key,key,...] [--note "..."] [--fresh]
//
// Each non-blank line of rows.txt that doesn't start with # is one pick:
//   slot|title|year|kind|minutes|episodes|seasons|imdb|rt|service|plexKey|poster|moods|why
// - kind: movie or series. moods: comma-separated. Empty fields are null.
// - plexKey: the shared server's ratingKey, for service plex (it builds the link).
// - poster: t:<file> for TMDB, m:<path> for Plex's metadata-static, or a full URL.
// - slot rate: something they watched, for the phones' "How was it?" card. Its
//   why says where it was seen; minutes, ratings, poster and moods can be blank.
// A row whose key is already in picks.json replaces that pick. --drop removes
// picks by key; --fresh starts from an empty list instead of the current one.
// Ranks are renumbered by order within each slot. Run push --dry afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PICKS = join(homedir(), 'Documents', 'General Issues', 'Watching', 'picks.json');
const SERVER = '9affd4117cb46178c7076c7c2a1b6020ac6bd95f';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args.splice(i, 2)[1];
};
const fresh = args.includes('--fresh') && args.splice(args.indexOf('--fresh'), 1);
const drop = new Set((flag('--drop') ?? '').split(',').filter(Boolean));
const note = flag('--note');
const [rowsPath] = args;
if (!rowsPath) throw new Error('usage: build-picks.mjs <rows.txt> [--drop key,...] [--note "..."] [--fresh]');

export const keyFor = (title, year) =>
  `${title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${year}`;

const num = (s) => (s === '' || s == null ? null : Number(s));
const poster = (p) =>
  !p ? null : p.startsWith('t:') ? `https://image.tmdb.org/t/p/w342/${p.slice(2)}` : p.startsWith('m:') ? `https://metadata-static.plex.tv/${p.slice(2)}` : p;

const rows = readFileSync(rowsPath, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((line, n) => {
    const f = line.split('|');
    if (f.length !== 14) throw new Error(`line ${n + 1}: ${f.length} fields, want 14: ${line.slice(0, 60)}`);
    const [slot, title, year, kind, minutes, episodes, seasons, imdb, rt, service, plexKey, art, moods, why] = f;
    if (service === 'plex' && !plexKey) throw new Error(`${title}: plex needs a plexKey`);
    if (why.length > 90) console.warn(`warning: ${title}: why is ${why.length} characters (90 max)`);
    return {
      key: keyFor(title, year),
      slot,
      title,
      year: num(year),
      kind,
      // The database wants a runtime; a rate row never shows one.
      minutes: num(minutes) ?? (slot === 'rate' ? 1 : null),
      episodes: num(episodes),
      seasons: num(seasons),
      imdb: num(imdb),
      rt: num(rt),
      service,
      link:
        service === 'plex'
          ? `https://app.plex.tv/desktop/#!/server/${SERVER}/details?key=${encodeURIComponent(`/library/metadata/${plexKey}`)}`
          : `https://www.primevideo.com/search?phrase=${encodeURIComponent(title)}`,
      poster: poster(art),
      moods: moods.split(',').filter(Boolean),
      why,
      rank: 0
    };
  });

const current = fresh ? { picks: [] } : JSON.parse(readFileSync(PICKS, 'utf8'));
const missing = [...drop].filter((k) => !current.picks.some((p) => p.key === k));
if (missing.length) console.warn(`warning: not in picks.json, nothing to drop: ${missing.join(', ')}`);

const byKey = new Map(rows.map((r) => [r.key, r]));
const kept = current.picks.filter((p) => !drop.has(p.key) && !byKey.has(p.key));
const picks = [...kept, ...rows];

const ranks = {};
for (const p of picks) p.rank = ranks[p.slot] = (ranks[p.slot] ?? 0) + 1;

writeFileSync(PICKS, JSON.stringify({ note: note ?? current.note ?? '', picks }, null, 1) + '\n');
console.log(`picks.json: ${picks.length} picks (${Object.entries(ranks).map(([s, n]) => `${s} ${n}`).join(', ')}); kept ${kept.length}, added or replaced ${rows.length}.`);
