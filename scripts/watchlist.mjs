// The shared watchlist, for the daily refresh.
//   node scripts/watchlist.mjs
//     prints it: typed names waiting to be matched, then every title with who
//     wants it, then what's been taken off (so it isn't pulled in again).
//   node scripts/watchlist.mjs save <rows.txt> [--remove key,...] [--dry]
//     sends the refresh's changes. --remove takes titles off both lists by
//     key (e.g. once they've watched them); --dry checks the file without
//     sending.
//
// Each non-blank line of rows.txt that doesn't start with # is one title:
//   from|title|year|kind|minutes|episodes|seasons|imdb|rt|service|plexKey|poster|note
// - from: whose watchlist it's on and where, as who:where (stuart:prime,
//   sarah:prime, stuart:plex), which puts it on that person's list unless
//   they took it off before; recheck, for a title already on the list whose
//   details are being refreshed; or the id of a typed name, to match it.
// - A typed name that can't be matched takes only its id and a note:
//   <id>||||||||||||Couldn't find this. Try another spelling.
// - service: prime, plex, shudder, or blank when it isn't on anything they
//   have; note then says where it is ("On Netflix", "Rent or buy on Prime").
// - plexKey and poster: as in build-picks.mjs.
import { readFileSync } from 'node:fs';
import { rpc } from './env.mjs';
import { keyFor, link, num, poster, readRows } from './rows.mjs';

const args = process.argv.slice(2);
// No process.exit() after a fetch: on Windows, Node can crash closing the connection.
if (args[0] === 'save') await save();
else await show();

async function show() {
  const rows = await rpc('watch_list_read', {});
  const day = (iso) => (iso ? iso.slice(0, 10) : '-');
  const on = rows.filter((r) => !r.removed_at);
  const typed = on.filter((r) => !r.key);
  const off = rows.filter((r) => r.removed_at);
  console.log(`Typed names to match (${typed.length}):`);
  for (const r of typed) console.log(`  ${r.id} | "${r.typed}" | ${r.who ?? '?'} ${day(r.added_at)}${r.note ? ` | ${r.note}` : ''}`);
  console.log(`On the list (${on.length - typed.length}): service | key | title | wanted by | checked`);
  for (const r of on.filter((r) => r.key)) {
    const offFor = r.taken_off ? ` | taken off by ${r.taken_off}` : '';
    console.log(`  ${r.service ?? '-'} | ${r.key} | ${r.title} | ${r.wants ?? '-'} | ${day(r.checked_at)}${offFor}${r.note ? ` | ${r.note}` : ''}`);
  }
  const both = on.filter((r) => r.wants?.includes(','));
  console.log(`Both want (${both.length}): ${both.map((r) => r.key ?? `"${r.typed}"`).join(', ') || '-'}`);
  console.log(`Taken off (${off.length}): ${off.map((r) => r.key ?? `"${r.typed}"`).join(', ') || '-'}`);
}

async function save() {
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args.splice(i, 2)[1];
  };
  const dry = args.includes('--dry') && args.splice(args.indexOf('--dry'), 1);
  const remove = (flag('--remove') ?? '').split(',').filter(Boolean);
  const [, rowsPath] = args;
  if (!rowsPath && !remove.length) throw new Error('usage: watchlist.mjs save <rows.txt> [--remove key,...] [--dry]');

  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const problems = [];
  const rows = (rowsPath ? readRows(readFileSync(rowsPath, 'utf8'), 13) : []).map((f) => {
    const [from, title, year, kind, minutes, episodes, seasons, imdb, rt, service, plexKey, art, note] = f;
    const id = ID.test(from) ? from : null;
    const [who, via] = id || from === 'recheck' ? [null, null] : from.split(':');
    const at = title || from;
    if (!id && from !== 'recheck' && !(['stuart', 'sarah'].includes(who) && ['prime', 'plex'].includes(via)))
      problems.push(`${at}: from must be stuart:prime, sarah:prime, stuart:plex, recheck or a typed name's id`);
    // A typed name that couldn't be matched: only its note changes.
    if (id && !title) return { id, key: null, note: note || null };
    if (!title || !year) problems.push(`${at}: needs a title and year`);
    if (!['movie', 'series'].includes(kind)) problems.push(`${at}: kind must be movie or series`);
    if (service && !['prime', 'plex', 'shudder'].includes(service)) problems.push(`${at}: service must be prime, plex, shudder or blank`);
    if (service === 'plex' && !plexKey) problems.push(`${at}: plex needs a plexKey`);
    if (minutes && !(Number.isInteger(num(minutes)) && num(minutes) > 0)) problems.push(`${at}: minutes must be a whole number above 0`);
    return {
      id,
      key: keyFor(title, year),
      title,
      year: num(year),
      kind,
      minutes: num(minutes),
      episodes: num(episodes),
      seasons: num(seasons),
      imdb: num(imdb),
      rt: num(rt),
      service: service || null,
      link: service ? link(service, title, plexKey) : null,
      poster: poster(art),
      note: note || null,
      who,
      via
    };
  });

  if (problems.length) {
    console.error(`Not sent. ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }

  const pulled = (name) => rows.filter((r) => r.who === name).length;
  const summary = [
    `${rows.filter((r) => r.id && r.key).length} matched`,
    `${rows.filter((r) => r.id && !r.key).length} not found`,
    `${pulled('stuart')} from Stuart's watchlists`,
    `${pulled('sarah')} from Sarah's`,
    `${rows.filter((r) => !r.id && !r.who).length} rechecked`,
    `${remove.length} taken off`
  ].join(', ');
  if (dry) {
    console.log(`OK, not sent (--dry): ${summary}.`);
  } else {
    const saved = await rpc('watch_list_save', { p_rows: rows, p_remove: remove });
    console.log(`Saved ${saved} (${summary}).`);
  }
}
