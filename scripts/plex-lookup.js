// Run in Edge on an app.plex.tv tab (Claude in Chrome, javascript_tool),
// after replacing the CANDIDATES line. It uses the Plex page's own sign-in,
// so no token leaves the browser. For each candidate it finds the title in
// Plex's catalogue, reads its ratings, runtime, poster and where it streams
// in Canada, and searches the shared Plex server's library.
//
// Output: window.__lookup holds the full objects, and the page body is
// replaced by one line per title (javascript_tool output is cut at ~1.5k
// characters, so read it with get_page_text). Reload the tab before running
// it again.
//
// service, in order of preference:
//   prime   - included with Prime
//   plex    - on the shared Plex server (SERVER below)
//   shudder - on the Shudder channel, only until SHUDDER_ENDS
//   -       - none of these: drop it
// platforms lists every Canadian offer, for judgment.

const CANDIDATES = [/* { title: 'Deadloch', year: 2023, kind: 'series' }, ... */];
const SERVER = 'VOICEDRIVE';
const SHUDDER_ENDS = '2026-11-16';

const cid = localStorage.getItem('clientID') || 'watch-pick';
const headers = { 'X-Plex-Token': localStorage.getItem('myPlexAccessToken'), 'X-Plex-Client-Identifier': cid, Accept: 'application/json' };
const api = 'https://discover.provider.plex.tv';
const get = async (path) => {
  const r = await fetch(api + path, { headers });
  if (!r.ok) throw new Error(`${r.status} ${path.slice(0, 60)}`);
  return (await r.json()).MediaContainer;
};

// The shared server: its first reachable connection and its own token.
let server = null;
try {
  const res = await (await fetch('https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers })).json();
  const s = res.find((x) => x.name === SERVER);
  const sh = { 'X-Plex-Token': s.accessToken, 'X-Plex-Client-Identifier': cid, Accept: 'application/json' };
  for (const c of s.connections.sort((a, b) => a.relay - b.relay)) {
    try {
      if ((await fetch(c.uri + '/identity', { headers: sh, signal: AbortSignal.timeout(6000) })).ok) {
        server = { base: c.uri, headers: sh, machine: s.clientIdentifier };
        break;
      }
    } catch {}
  }
} catch {}

async function onServer(c, type) {
  if (!server) return null;
  const r = await fetch(`${server.base}/search?query=${encodeURIComponent(c.title)}`, { headers: server.headers });
  if (!r.ok) return null;
  const items = (await r.json()).MediaContainer.Metadata || [];
  return items.find((m) => m.type === type && (!c.year || Math.abs((m.year || 0) - c.year) <= 1)) || null;
}

const shudderOn = new Date().toISOString().slice(0, 10) <= SHUDDER_ENDS;

async function lookup(c) {
  const type = c.kind === 'series' ? 'show' : 'movie';
  const found = await get(
    `/library/search?query=${encodeURIComponent(c.title)}&limit=10&searchTypes=movies,tv&searchProviders=discover&includeMetadata=1`
  );
  const hits = (found.SearchResults || []).flatMap((s) => s.SearchResult || []).map((x) => x.Metadata);
  const hit =
    hits.find((m) => m.type === type && (!c.year || Math.abs((m.year || 0) - c.year) <= 1)) ||
    hits.find((m) => m.type === type);
  if (!hit) return { ...c, error: 'not found' };

  const [meta, offers, local] = await Promise.all([
    get(`/library/metadata/${hit.ratingKey}`).then((m) => m.Metadata[0]),
    get(`/library/metadata/${hit.ratingKey}/availabilities?country=CA`).then((m) => m.Availability || []),
    onServer(c, type).catch(() => null)
  ]);
  const rating = (prefix) => (meta.Rating || []).find((r) => r.image === prefix)?.value ?? null;
  const rtRaw = rating('rottentomatoes://image.rating.ripe') ?? rating('rottentomatoes://image.rating.rotten');
  const prime = offers.some((o) => /^amazon-prime-video/.test(o.platform) && o.offerType === 'subscription');
  const shudder = shudderOn && offers.some((o) => o.platform === 'shudder-amazon-channel');
  const service = prime ? 'prime' : local ? 'plex' : shudder ? 'shudder' : '-';
  const thumb = (meta.thumb || '').replace('/t/p/original/', '/t/p/w342/');
  const primeSearch = `https://www.primevideo.com/search?phrase=${encodeURIComponent(meta.title)}`;
  return {
    title: meta.title,
    year: meta.year ?? null,
    kind: c.kind,
    minutes: meta.duration ? Math.round(meta.duration / 60000) : null,
    episodes: meta.leafCount ?? null,
    seasons: meta.childCount ?? null,
    imdb: rating('imdb://image.rating'),
    rt: rtRaw == null ? null : Math.round(rtRaw * 10),
    service,
    link:
      service === 'plex'
        ? `https://app.plex.tv/desktop/#!/server/${server.machine}/details?key=${encodeURIComponent(`/library/metadata/${local.ratingKey}`)}`
        : service === '-'
          ? null
          : primeSearch,
    // The catalogue's poster, never the server's: a server image URL would need its token.
    poster: thumb || null,
    onPlexServer: !!local,
    genres: (meta.Genre || []).map((g) => g.tag).join('/'),
    rated: meta.contentRating || '',
    platforms: [...new Set(offers.map((o) => `${o.platform}:${o.offerType}`))].join(' ')
  };
}

// Six at a time: javascript_tool gives up after 45 seconds.
const results = [];
for (let i = 0; i < CANDIDATES.length; i += 6) {
  const batch = CANDIDATES.slice(i, i + 6);
  results.push(
    ...(await Promise.all(batch.map((c) => lookup(c).catch((e) => ({ ...c, error: String(e.message || e) })))))
  );
}
window.__lookup = results;
const lines = results.map((r) =>
  r.error
    ? `${r.title} | ERROR ${r.error}`
    : [r.title, r.year, r.kind, r.minutes, r.episodes ?? '', r.seasons ?? '', r.imdb ?? '', r.rt ?? '', r.service, r.onPlexServer ? 'on server' : '', r.genres, r.rated, r.platforms].join(' | ')
);
const pre = document.createElement('pre');
pre.textContent =
  `server: ${server ? 'connected' : 'NOT reachable'}\n` +
  'title | year | kind | min | eps | seasons | imdb | rt | service | server | genres | rated | platforms\n' +
  lines.join('\n');
document.body.replaceChildren(pre);
`${results.length} looked up; ${results.filter((r) => ['prime', 'plex', 'shudder'].includes(r.service)).length} watchable. Read with get_page_text.`;
