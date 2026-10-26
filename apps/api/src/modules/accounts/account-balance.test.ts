import { describe, expect, it } from 'vitest';

import {
  calculateCurrentBalance,
  describeAccountBalance,
  NO_MOVEMENTS,
  summarizeBalances,
  type MovementTotals,
} from './account-balance';

function totals(partial: Partial<MovementTotals>): MovementTotals {
  return { ...NO_MOVEMENTS, ...partial };
}

describe('calculateCurrentBalance', () => {
  it('equals the opening balance when nothing has been recorded', () => {
    expect(calculateCurrentBalance(1_250_050n, NO_MOVEMENTS)).toBe(1_250_050n);
    expect(calculateCurrentBalance(0n, NO_MOVEMENTS)).toBe(0n);
  });

  it('adds income and transfers in, subtracts expenses and transfers out', () => {
    expect(
      calculateCurrentBalance(
        100_000n,
        totals({
          incomeMinor: 50_000n,
          expenseMinor: 20_000n,
          transfersOutMinor: 30_000n,
          transfersInMinor: 5_000n,
        }),
      ),
    ).toBe(105_000n);
  });

  it('stays exact beyond the safe range of JavaScript numbers', () => {
    const opening = 999_999_999_999_999n;
    expect(calculateCurrentBalance(opening, totals({ incomeMinor: 999_999_999_999_999n }))).toBe(
      1_999_999_999_999_998n,
    );
  });
});

describe('describeAccountBalance', () => {
  it('reports assets as money held, without liability fields', () => {
    expect(
      describeAccountBalance(
        { type: 'savings', openingBalanceMinor: 500_000n, creditLimitMinor: null },
        totals({ incomeMinor: 100_000n, counted: 1 }),
      ),
    ).toEqual({ currentBalanceMinor: '600000', countedTransactions: 1 });
  });

  it('reports a credit card as an amount owed with the available credit', () => {
    // Opened owing ₹12,500; spent ₹2,000; paid ₹5,000 from a bank account (a transfer in).
    expect(
      describeAccountBalance(
        { type: 'credit_card', openingBalanceMinor: -1_250_000n, creditLimitMinor: 10_000_000n },
        totals({ expenseMinor: 200_000n, transfersInMinor: 500_000n, counted: 2 }),
      ),
    ).toEqual({
      currentBalanceMinor: '-950000',
      amountOwedMinor: '950000',
      availableCreditMinor: '9050000',
      countedTransactions: 2,
    });
  });

  it('omits available credit when no limit is known, and shows a card in credit as negative owed', () => {
    expect(
      describeAccountBalance(
        { type: 'credit_card', openingBalanceMinor: 30_000n, creditLimitMinor: null },
        NO_MOVEMENTS,
      ),
    ).toEqual({ currentBalanceMinor: '30000', amountOwedMinor: '-30000', countedTransactions: 0 });
  });

  it('lets available credit go negative when the card is over its limit', () => {
    expect(
      describeAccountBalance(
        { type: 'credit_card', openingBalanceMinor: -110_000n, creditLimitMinor: 100_000n },
        NO_MOVEMENTS,
      ).availableCreditMinor,
    ).toBe('-10000');
  });
});

describe('summarizeBalances', () => {
  it('never adds liabilities to assets, and keeps currencies apart', () => {
    expect(
      summarizeBalances([
        { currency: 'INR', classification: 'asset', currentBalanceMinor: 2_000_000n },
        { currency: 'INR', classification: 'asset', currentBalanceMinor: -50_000n }, // overdraft
        { currency: 'INR', classification: 'liability', currentBalanceMinor: -1_250_000n },
        { currency: 'USD', classification: 'asset', currentBalanceMinor: 10_000n },
      ]),
    ).toEqual({
      currencies: [
        {
          currency: 'INR',
          assetsMinor: '1950000',
          liabilitiesMinor: '1250000',
          assetAccounts: 2,
          liabilityAccounts: 1,
        },
        {
          currency: 'USD',
          assetsMinor: '10000',
          liabilitiesMinor: '0',
          assetAccounts: 1,
          liabilityAccounts: 0,
        },
      ],
    });
  });

  it('handles a user without accounts', () => {
    expect(summarizeBalances([])).toEqual({ currencies: [] });
  });
});
