// Saves the TMDB key from the clipboard into .env.local as TMDB_TOKEN, without
// ever printing it. Copy the "API Read Access Token" on
// themoviedb.org/settings/api, then run: npm.cmd run tmdb-key
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ENV_FILE } from './env.mjs';

const value = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' }).trim();
const kind = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value) ? 'read access token' : /^[0-9a-f]{32}$/.test(value) ? 'API key' : null;
if (!kind) {
  console.error("The clipboard doesn't hold a TMDB key. Copy the API Read Access Token on themoviedb.org/settings/api and run this again.");
  process.exit(1);
}
const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
const lines = text.split(/\r?\n/).filter((l) => !/^\s*TMDB_TOKEN\s*=/.test(l));
while (lines.length && lines[lines.length - 1] === '') lines.pop();
writeFileSync(ENV_FILE, [...lines, `TMDB_TOKEN=${value}`, ''].join('\n'));
console.log(`Saved TMDB_TOKEN to .env.local (the ${kind}, ${value.length} characters). You can copy something else now.`);
