import { describe, expect, it } from 'vitest';
import { arrivedWhy, diffArrivals, wantedBy } from './arrivals.mjs';

const m = (o) => new Map(Object.entries(o));

describe('diffArrivals', () => {
  it('only records on the first run', () => {
    const r = diffArrivals(null, m({ a: 'prime' }), '2026-11-19');
    expect(r.fresh).toEqual([]);
    expect(r.state).toEqual({ known: { a: 'prime' }, arrived: {} });
  });

  it('announces what became watchable since the last run', () => {
    const r = diffArrivals({ known: { a: 'prime' }, arrived: {} }, m({ a: 'prime', b: 'plex' }), '2026-11-20');
    expect(r.fresh).toEqual(['b']);
    expect(r.state.arrived).toEqual({ b: { at: '2026-11-20', service: 'plex' } });
  });

  it('keeps an arrival for a week, and drops it if it leaves', () => {
    const state = { known: { a: 'prime', b: 'plex' }, arrived: { a: { at: '2026-11-14', service: 'prime' }, b: { at: '2026-11-12', service: 'plex' } } };
    expect(diffArrivals(state, m({ a: 'prime', b: 'plex' }), '2026-11-20').state.arrived).toEqual({ a: state.arrived.a });
    expect(diffArrivals(state, m({ b: 'plex' }), '2026-11-15').state.arrived).toEqual({ b: state.arrived.b });
  });

  it('counts a title that left and came back as arriving again', () => {
    const left = diffArrivals({ known: { a: 'prime' }, arrived: {} }, m({}), '2026-11-20').state;
    expect(diffArrivals(left, m({ a: 'prime' }), '2026-11-25').fresh).toEqual(['a']);
  });
});

describe('the card line', () => {
  it('names whose list it was on', () => {
    expect(wantedBy('Sarah (prime), Stuart (app)')).toEqual(['Sarah', 'Stuart']);
    expect(arrivedWhy('Sarah (prime), Stuart (app)', '2026-11-20', 'prime')).toBe('On both your watchlists, now on Prime (Nov 20)');
    expect(arrivedWhy('Stuart (plex)', '2026-11-20', 'plex')).toBe("On Stuart's watchlist, now on Plex (Nov 20)");
  });
});
