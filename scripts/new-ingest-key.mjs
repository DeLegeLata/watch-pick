// Makes the PC's ingest token. The token goes into .env.local (git-ignored)
// and is never printed; only its SHA-256 hash goes into
// supabase/ingest-key.local.sql, the one line to run in the SQL editor.
// Running it again replaces the token, so run that line again too.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ENV_FILE } from './env.mjs';

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');

let env = '';
try {
  env = readFileSync(ENV_FILE, 'utf8');
} catch {
  // A new .env.local is fine; the VITE_ values still need adding.
}
env = /^WATCH_INGEST_TOKEN=.*$/m.test(env)
  ? env.replace(/^WATCH_INGEST_TOKEN=.*$/m, `WATCH_INGEST_TOKEN=${token}`)
  : `${env.replace(/\s*$/, '')}\nWATCH_INGEST_TOKEN=${token}\n`;
writeFileSync(ENV_FILE, env);

const sql = `-- Run once in the Supabase SQL editor, after supabase/watch.sql.
insert into watch_ingest_keys (household_id, token_hash)
select id, decode('${hash}', 'hex') from households order by created_at limit 1
on conflict (household_id) do update set token_hash = excluded.token_hash, created_at = now();
`;
const out = new URL('../supabase/ingest-key.local.sql', import.meta.url);
writeFileSync(out, sql);
console.log('Saved a new token in .env.local and wrote supabase/ingest-key.local.sql.');
