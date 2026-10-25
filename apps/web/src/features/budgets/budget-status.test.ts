import { describe, expect, it } from 'vitest';

import { getBudgetStatus, NEAR_LIMIT_PERCENT } from './budget-status';

describe('getBudgetStatus', () => {
  it('is on track below the near-limit threshold', () => {
    expect(getBudgetStatus(0).status).toBe('on-track');
    expect(getBudgetStatus(NEAR_LIMIT_PERCENT - 1).status).toBe('on-track');
  });

  it('warns from the threshold up to the full limit', () => {
    expect(getBudgetStatus(NEAR_LIMIT_PERCENT).status).toBe('near-limit');
    expect(getBudgetStatus(100).status).toBe('near-limit');
  });

  it('flags overspending with a label, not only a colour', () => {
    const status = getBudgetStatus(115);
    expect(status).toMatchObject({
      status: 'over-budget',
      label: 'Over budget',
      badgeTone: 'negative',
    });
  });
});
