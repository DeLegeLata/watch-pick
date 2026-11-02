// Posts the week's picks to Supabase as a new run.
//   node scripts/push-picks.mjs [picks.json] [--dry]
// The default file is General Issues\Watching\picks.json. --dry checks it
// without sending.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rpc } from './env.mjs';

const DEFAULT = join(homedir(), 'Documents', 'General Issues', 'Watching', 'picks.json');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--')) ?? DEFAULT;

const doc = JSON.parse(readFileSync(file, 'utf8'));
const picks = Array.isArray(doc) ? doc : doc.picks;
const note = Array.isArray(doc) ? null : (doc.note ?? null);

// 'rate' rows aren't picks: the phones ask "How was it?" about them.
const SLOTS = ['resume', 'safe', 'watchlist', 'new', 'rate'];
const MOODS = ['laugh', 'tense', 'mystery', 'cozy'];
const problems = [];
const keys = new Set();
picks.forEach((p, i) => {
  const at = `#${i + 1} ${p.title ?? '(no title)'}`;
  for (const f of ['key', 'slot', 'title', 'kind', 'minutes', 'service', 'why'])
    if (p[f] == null || p[f] === '') problems.push(`${at}: missing ${f}`);
  if (!SLOTS.includes(p.slot)) problems.push(`${at}: slot must be one of ${SLOTS.join(', ')}`);
  if (!['movie', 'series'].includes(p.kind)) problems.push(`${at}: kind must be movie or series`);
  if (!['prime', 'plex', 'shudder'].includes(p.service)) problems.push(`${at}: service must be prime, plex or shudder`);
  if (!(Number.isInteger(p.minutes) && p.minutes > 0)) problems.push(`${at}: minutes must be a whole number above 0`);
  if (p.rt != null && !(p.rt >= 0 && p.rt <= 100)) problems.push(`${at}: rt is a percentage`);
  for (const m of p.moods ?? []) if (!MOODS.includes(m)) problems.push(`${at}: unknown mood ${m}`);
  if (keys.has(p.key)) problems.push(`${at}: duplicate key ${p.key}`);
  keys.add(p.key);
});

if (problems.length) {
  console.error(`Not sent. ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const bySlot = (list) =>
  SLOTS.map((s) => [s, list.filter((p) => p.slot === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `${s} ${n}`)
    .join(', ');
if (dry) {
  console.log(`OK, not sent (--dry): ${picks.length} picks (${bySlot(picks)}).`);
} else {
  let sent = picks;
  let added;
  try {
    added = await rpc('watch_ingest', { p_picks: sent, p_note: note });
  } catch (e) {
    // A database that hasn't had the 2026-11-02 watch.sql yet refuses 'rate' rows; send the picks without them.
    if (!/watch_picks_slot_check/.test(String(e.message)) || !picks.some((p) => p.slot === 'rate')) throw e;
    sent = picks.filter((p) => p.slot !== 'rate');
    added = await rpc('watch_ingest', { p_picks: sent, p_note: note });
    console.warn('warning: the database refused the "How was it?" rows (run supabase/watch.sql); sent the picks without them.');
  }
  console.log(`Sent ${added} picks (${bySlot(sent)}).`);
}
