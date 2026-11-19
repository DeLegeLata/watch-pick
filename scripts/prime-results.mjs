// Saves prime-check.js's lines (key|status|message) into the catalogue's
// record of what Prime itself said, Watching\cache\prime-checks.json.
//   node scripts/prime-results.mjs <file>
// The catalogue drops "no" titles for 60 days and rechecks the rest later.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = join(homedir(), 'Documents', 'General Issues', 'Watching', 'cache', 'prime-checks.json');
const [input] = process.argv.slice(2);
if (!input) throw new Error('usage: prime-results.mjs <file of key|status|message lines>');

const checks = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const at = new Date().toISOString().slice(0, 10);
const tally = {};
for (const line of readFileSync(input, 'utf8').split(/\r?\n/)) {
  const [key, status, ...msg] = line.trim().split('|');
  if (!key || !['ok', 'maybe', 'no', 'unknown'].includes(status)) continue;
  checks[key] = { status, msg: msg.join('|'), at };
  tally[status] = (tally[status] ?? 0) + 1;
}
writeFileSync(FILE, JSON.stringify(checks, null, 1));
console.log(`Saved ${Object.values(tally).reduce((a, b) => a + b, 0)} Prime checks (${Object.entries(tally).map(([s, n]) => `${s} ${n}`).join(', ')}); ${Object.keys(checks).length} on record.`);
