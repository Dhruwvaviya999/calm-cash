import { describe, expect, it } from 'vitest';

import { DEFAULT_SELECTION, readSelection, selectionToQuery } from './dashboard-selection';

describe('dashboard selection in the URL', () => {
  it('reads presets, custom ranges, and currencies', () => {
    expect(readSelection(new URLSearchParams(''))).toEqual(DEFAULT_SELECTION);
    expect(readSelection(new URLSearchParams('period=last-6-months&currency=USD'))).toEqual({
      period: 'last-6-months',
      currency: 'USD',
    });
    expect(
      readSelection(new URLSearchParams('period=custom&from=2026-03-01&to=2026-03-31')),
    ).toEqual({ period: 'custom', from: '2026-03-01', to: '2026-03-31' });
  });

  it('falls back to the defaults for anything malformed, keeping a valid currency', () => {
    expect(readSelection(new URLSearchParams('period=forever&currency=EUR'))).toEqual({
      ...DEFAULT_SELECTION,
      currency: 'EUR',
    });
    expect(
      readSelection(new URLSearchParams('period=custom&from=2026-03-31&to=2026-03-01')),
    ).toEqual(DEFAULT_SELECTION);
    expect(readSelection(new URLSearchParams('currency=XYZ&userId=1'))).toEqual(DEFAULT_SELECTION);
  });

  it('writes short URLs with defaults left out, round-tripping exactly', () => {
    expect(selectionToQuery(DEFAULT_SELECTION)).toBe('');
    const custom = {
      period: 'custom',
      from: '2026-03-01',
      to: '2026-03-31',
      currency: 'INR',
    } as const;
    expect(selectionToQuery(custom)).toBe(
      'period=custom&from=2026-03-01&to=2026-03-31&currency=INR',
    );
    expect(readSelection(new URLSearchParams(selectionToQuery(custom)))).toEqual(custom);
  });
});
