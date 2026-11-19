// "Just arrived": titles on the shared watchlist that have become watchable
// (included with Prime, confirmed by Prime itself, or on the Plex server)
// since the last run. catalogue.mjs keeps the state in
// Watching\cache\arrivals.json and puts each arrival at the top of Tonight
// for a week. Pure functions, tested in arrivals.test.mjs.

export const ARRIVED_DAYS = 7;

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Compares what's watchable now (key -> service) with the last run.
 * state is { known: {key: service}, arrived: {key: {at, service}} }, or null
 * on the first run, which only records what's already watchable: those
 * titles didn't just arrive. Returns the new state and today's new arrivals.
 * An arrival stays for ARRIVED_DAYS, and goes as soon as it isn't watchable.
 */
export function diffArrivals(state, now, today, days = ARRIVED_DAYS) {
  const known = Object.fromEntries(now);
  if (!state) return { state: { known, arrived: {} }, fresh: [] };
  const fresh = [...now.keys()].filter((k) => !(k in state.known));
  const arrived = {};
  for (const [k, a] of Object.entries(state.arrived)) {
    if (now.has(k) && daysBetween(a.at, today) < days) arrived[k] = a;
  }
  for (const k of fresh) arrived[k] = { at: today, service: now.get(k) };
  return { state: { known, arrived }, fresh };
}

/** "Sarah (prime), Stuart (app)" from watch_list_read, as the names that want it. */
export const wantedBy = (wants) => (wants ?? '').split(', ').map((w) => w.replace(/ \(.*\)$/, '')).filter(Boolean);

/** The card's line: whose list it was on and when it arrived. */
export function arrivedWhy(wants, at, service) {
  const names = wantedBy(wants);
  const where = service === 'plex' ? 'Plex' : 'Prime';
  const day = new Date(`${at}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const whose = names.length > 1 ? 'both your watchlists' : names.length ? `${names[0]}'s watchlist` : 'your watchlist';
  return `On ${whose}, now on ${where} (${day})`;
}
