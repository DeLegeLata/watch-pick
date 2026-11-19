// Run in Edge on an app.plex.tv tab (Claude in Chrome, javascript_tool) on
// Fridays, or whenever the server's library has grown. It saves every
// unwatched movie and show on the shared server VOICEDRIVE, with its IMDb and
// TMDB ids, to Downloads\voicedrive-library.json, which catalogue.mjs reads.
// It uses the Plex page's own sign-in, so no token leaves the browser.
// "Unwatched" is the shared account's: Plex can't tell who watched what.

const SERVER = 'VOICEDRIVE';
const cid = localStorage.getItem('clientID') || 'watch-pick';
const headers = { 'X-Plex-Token': localStorage.getItem('myPlexAccessToken'), 'X-Plex-Client-Identifier': cid, Accept: 'application/json' };

const resources = await (await fetch('https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers })).json();
const s = resources.find((x) => x.name === SERVER);
const sh = { 'X-Plex-Token': s.accessToken, 'X-Plex-Client-Identifier': cid, Accept: 'application/json' };
let base = null;
for (const c of s.connections.sort((a, b) => a.relay - b.relay)) {
  try {
    if ((await fetch(c.uri + '/identity', { headers: sh, signal: AbortSignal.timeout(6000) })).ok) {
      base = c.uri;
      break;
    }
  } catch {}
}
if (!base) throw new Error(`${SERVER} isn't reachable`);

const sections = (await (await fetch(`${base}/library/sections`, { headers: sh })).json()).MediaContainer.Directory.filter(
  (d) => d.type === 'movie' || d.type === 'show'
);
const items = [];
for (const sec of sections) {
  const r = await fetch(`${base}/library/sections/${sec.key}/all?unwatched=1&includeGuids=1`, { headers: sh });
  for (const m of (await r.json()).MediaContainer.Metadata || []) {
    const id = (p) => (m.Guid || []).find((g) => g.id.startsWith(p))?.id.slice(p.length) ?? null;
    items.push({ k: m.ratingKey, title: m.title, year: m.year ?? null, type: m.type, imdb: id('imdb://'), tmdb: id('tmdb://') });
  }
}

const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([JSON.stringify({ exported: new Date().toISOString(), server: SERVER, items })], { type: 'application/json' }));
a.download = 'voicedrive-library.json';
document.body.append(a);
a.click();
`${items.length} unwatched titles from ${sections.length} sections saved to Downloads\\voicedrive-library.json`;
