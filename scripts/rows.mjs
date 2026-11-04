// What build-picks.mjs and watchlist.mjs share: keys, links and posters for
// the pipe-separated rows files the refresh writes.

const SERVER = '9affd4117cb46178c7076c7c2a1b6020ac6bd95f';

/** Lower-case title words joined by hyphens, plus the year: the same for a title on every run. */
export const keyFor = (title, year) =>
  `${title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${year}`;

export const num = (s) => (s === '' || s == null ? null : Number(s));

/** t:<file> for TMDB, m:<path> for Plex's metadata-static, or a full URL. */
export const poster = (p) =>
  !p ? null : p.startsWith('t:') ? `https://image.tmdb.org/t/p/w342/${p.slice(2)}` : p.startsWith('m:') ? `https://metadata-static.plex.tv/${p.slice(2)}` : p;

/** The shared Plex server's page for a ratingKey, or a Prime search for the title. */
export const link = (service, title, plexKey) =>
  service === 'plex'
    ? `https://app.plex.tv/desktop/#!/server/${SERVER}/details?key=${encodeURIComponent(`/library/metadata/${plexKey}`)}`
    : `https://www.primevideo.com/search?phrase=${encodeURIComponent(title)}`;

/** The non-blank lines of a rows file that aren't comments, split on |, each checked for `fields` fields. */
export function readRows(text, fields) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((line, n) => {
      const f = line.split('|');
      if (f.length !== fields) throw new Error(`line ${n + 1}: ${f.length} fields, want ${fields}: ${line.slice(0, 60)}`);
      return f;
    });
}
