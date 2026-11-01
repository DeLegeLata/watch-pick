// Reads .env.local for the PC scripts. Nothing here is printed.
import { readFileSync } from 'node:fs';

export const ENV_FILE = new URL('../.env.local', import.meta.url);

export function readEnv() {
  let text = '';
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new Error('No .env.local in the watch-pick folder. Copy .env.example and fill it in.');
  }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Calls a Supabase RPC with the publishable key; the ingest token goes in the body. */
export async function rpc(name, body) {
  const env = readEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const token = env.WATCH_INGEST_TOKEN;
  if (!url || !key) throw new Error('.env.local needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  if (!token) throw new Error('.env.local has no WATCH_INGEST_TOKEN. Run `npm run new-key` first.');
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, ...body })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}
