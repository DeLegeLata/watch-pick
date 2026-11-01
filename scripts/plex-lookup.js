// Run in Edge on an app.plex.tv tab (Claude in Chrome, javascript_tool),
// after replacing the CANDIDATES line. It uses the Plex page's own guest
// session, so no token leaves the browser. For each candidate it finds the
// title in Plex's catalogue, then reads its ratings, runtime, poster and
// where it streams in Canada.
//
// Output: window.__lookup holds the full objects, and the page body is
// replaced by one line per title (javascript_tool output is cut at ~1.5k
// characters, so read it with get_page_text). Reload the tab before running
// it again.
//
// service is 'prime' (included with Prime), 'plex' (free on Plex) or '-'
// (neither: drop it). platforms lists every Canadian offer, for judgment.

const CANDIDATES = [/* { title: 'Deadloch', year: 2023, kind: 'series' }, ... */];

const headers = {
  'X-Plex-Token': localStorage.getItem('myPlexAccessToken'),
  'X-Plex-Client-Identifier': localStorage.getItem('clientID') || 'watch-pick',
  Accept: 'application/json'
};
const api = 'https://discover.provider.plex.tv';
const get = async (path) => {
  const r = await fetch(api + path, { headers });
  if (!r.ok) throw new Error(`${r.status} ${path.slice(0, 60)}`);
  return (await r.json()).MediaContainer;
};

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

  const [meta, offers] = await Promise.all([
    get(`/library/metadata/${hit.ratingKey}`).then((m) => m.Metadata[0]),
    get(`/library/metadata/${hit.ratingKey}/availabilities?country=CA`).then((m) => m.Availability || [])
  ]);
  const rating = (prefix) => (meta.Rating || []).find((r) => r.image === prefix)?.value ?? null;
  const rtRaw = rating('rottentomatoes://image.rating.ripe') ?? rating('rottentomatoes://image.rating.rotten');
  const prime = offers.some((o) => /^amazon-prime-video/.test(o.platform) && o.offerType === 'subscription');
  const plex = offers.some((o) => /^plex/.test(o.platform) && /free|ads|avod/.test(o.offerType));
  const service = prime ? 'prime' : plex ? 'plex' : '-';
  const thumb = (meta.thumb || '').replace('/t/p/original/', '/t/p/w342/');
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
      service === 'prime'
        ? `https://www.primevideo.com/search?phrase=${encodeURIComponent(meta.title)}`
        : service === 'plex'
          ? `https://watch.plex.tv/${type}/${meta.slug}`
          : null,
    poster: thumb || null,
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
    : [r.title, r.year, r.kind, r.minutes, r.episodes ?? '', r.seasons ?? '', r.imdb ?? '', r.rt ?? '', r.service, r.genres, r.rated, r.platforms].join(' | ')
);
const pre = document.createElement('pre');
pre.textContent = 'title | year | kind | min | eps | seasons | imdb | rt | service | genres | rated | platforms\n' + lines.join('\n');
document.body.replaceChildren(pre);
`${results.length} looked up; ${results.filter((r) => r.service === 'prime' || r.service === 'plex').length} streamable. Read with get_page_text.`;
