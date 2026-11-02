// Prints the "not for us" taps from the phones since a date.
//   node scripts/feedback.mjs [YYYY-MM-DD]
// With no date it covers the last 8 days.
import { rpc } from './env.mjs';

const arg = process.argv[2];
const since = arg ? new Date(`${arg}T00:00:00`) : new Date(Date.now() - 8 * 86_400_000);
const rows = await rpc('watch_feedback_since', { p_since: since.toISOString() });

if (!rows.length) {
  console.log(`No feedback since ${since.toISOString().slice(0, 10)}.`);
} else {
  const RATED = ['didn’t watch it', 'didn’t like it', 'meh', 'liked it', 'loved it'];
  for (const r of rows) {
    const verdict = r.reason === 'seen' && r.rating != null ? ` (${RATED[r.rating]})` : '';
    console.log(`${r.created_at.slice(0, 10)} | ${r.who ?? '?'} | ${r.reason}${verdict} | ${r.title} | ${r.key}`);
  }
}
