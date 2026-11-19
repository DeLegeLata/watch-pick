// Run in Edge on a primevideo.com tab (Claude in Chrome, javascript_tool) at
// the start of each refresh, after replacing the CANDIDATES line with the
// contents of Watching\cache\prime-to-check.json (the catalogue writes it:
// the Prime picks the phones will deal next that haven't been checked).
// TMDB's Canadian Prime list is mostly right, not always (SVU showed as
// included but is purchase-only), so this asks Prime itself.
//
// Output: the page body becomes one line per title, read with get_page_text:
//   key|status|what Prime says
// status: ok (Included with Prime), maybe (included with "your
// subscriptions", which can mean a channel trial), no (buy, rent or
// subscribe), unknown (search didn't find that title). Save the lines to a
// file and run: node scripts/prime-results.mjs <file>

const CANDIDATES = [/* { key, title, year }, ... */];

const parse = (h) => new DOMParser().parseFromString(h, 'text/html');
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

async function check(c) {
  const s = parse(await (await fetch('/search?phrase=' + encodeURIComponent(c.title))).text());
  const want = norm(c.title);
  // The first result whose text starts with the title: search can put a different show first.
  const art = [...s.querySelectorAll('article')].find((a) => norm(a.textContent).startsWith(want));
  const href = art?.querySelector('a[href*="/detail/"]')?.getAttribute('href');
  if (!href) return `${c.key}|unknown|not found in search`;
  const d = parse(await (await fetch(href)).text());
  const icon = d.querySelector('[data-testid="entitlement-icon"] title')?.textContent ?? '';
  const msg = (d.querySelector('[data-testid="entitlement-message"]')?.textContent ?? '').trim().replace(/\|/g, '/');
  const status = icon !== 'Entitled' ? 'no' : /included with prime/i.test(msg) ? 'ok' : 'maybe';
  return `${c.key}|${status}|${msg || '(no message)'}`;
}

const lines = [];
for (let i = 0; i < CANDIDATES.length; i += 6) {
  lines.push(...(await Promise.all(CANDIDATES.slice(i, i + 6).map((c) => check(c).catch((e) => `${c.key}|unknown|${e.message}`)))));
}
const pre = document.createElement('pre');
pre.textContent = lines.join('\n');
document.body.replaceChildren(pre);
`${lines.length} checked: ${['ok', 'maybe', 'no', 'unknown'].map((s) => `${s} ${lines.filter((l) => l.split('|')[1] === s).length}`).join(', ')}. Read with get_page_text.`;
