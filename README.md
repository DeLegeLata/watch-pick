# What to Watch

Three picks for tonight that the two of us will both like, from what's
included with Prime Video or free on Plex. It runs on both phones as an
installed web app: <https://delegelata.github.io/watch-pick/>.

- **The phones** show tonight's picks. You choose how long you have (45 min,
  1½ h, 2 h +) and a mood, and get a "pick up where you left off" card plus a
  safe bet, a watchlist pick and something new. **Show three others** and
  **Shuffle** deal more from the week's list. **Not for us…** is the only
  thing the phones write: not for us, not for me, we've seen it, or not
  tonight. Either phone's tap hides the title on both.
- **The weekly refresh** runs on the home PC as a scheduled Claude task, every
  Friday afternoon. Through Claude in Chrome on the signed-in Edge, it reads
  the new Prime watch history, Continue Watching and the watchlist. It reads
  the week's taps, picks about 30 titles from the taste profile in
  `Documents\General Issues\Watching`, and checks each one for availability
  in Canada. It then posts them with `npm run push`. No Amazon password or
  cookie is stored anywhere. The steps are in the `/watch-pick` skill
  (`~/.claude/skills/watch-pick/SKILL.md`, part B).
- **The data** lives in the sleep app's Supabase project, behind the same two
  sign-ins and row-level security. This repo is public and holds only code.

## Setup

1. **Database.** In the Supabase SQL editor for the sleep app's project, run
   all of [`supabase/watch.sql`](supabase/watch.sql). Then run the one line in
   `supabase/ingest-key.local.sql`. That file exists only on the home PC, and
   `npm run new-key` makes it. It stores the hash of the PC's token. The token
   itself stays in `.env.local`.
2. **Build settings.** The repository variables `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` are the sleep app's two public values.
   Pages builds from GitHub Actions ([`pages.yml`](.github/workflows/pages.yml)).
3. **Phones.**
   - **iPhone:** open the address in Safari, then Share → Add to Home Screen.
   - **Android:** open it in Chrome, then ⋮ → Add to Home screen.

   Sign in with the same email and password as the sleep app.

## Local

```bash
npm install
npm run dev          # http://localhost:5173/watch-pick/  (add ?demo for sample picks)
npm test             # the picking rules
npm run push -- --dry   # check General Issues\Watching\picks.json without sending
npm run feedback     # the phones' taps from the last 8 days
```

`scripts/plex-lookup.js` is the availability check the refresh runs in an
app.plex.tv tab. It uses that page's own guest session.
