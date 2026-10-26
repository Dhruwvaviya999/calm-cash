import {
  getAccountClassification,
  serializeMinorUnits,
  type AccountBalanceDto,
  type AccountClassification,
  type AccountSummaryDto,
  type AccountType,
  type CurrencyBalanceSummaryDto,
  type CurrencyCode,
} from '@calmcash/shared';

// The single place where CalmCash turns stored figures into balances. Pure functions over
// `bigint` minor units: no floating point, no I/O. The repository supplies per-account movement
// totals; everything that interprets them lives here.
//
//   current balance = opening balance
//                   + income            (on this account)
//                   − expenses          (on this account)
//                   − transfers out     (this account is the source)
//                   + transfers in      (this account is the destination)
//
// counting only transactions of the same owner and currency that occurred on or after the start of
// the opening-balance date. Balances are signed net positions for every type (positive = held,
// negative = owed), so one formula serves assets and liabilities: a card purchase is an expense
// that makes the card more negative, and paying the card is a transfer that brings it back to zero.
// Transfers only move money between accounts; they are never income or expenses.

export interface MovementTotals {
  incomeMinor: bigint;
  expenseMinor: bigint;
  transfersOutMinor: bigint;
  transfersInMinor: bigint;
  /** Transactions included in the totals. */
  counted: number;
}

export const NO_MOVEMENTS: Readonly<MovementTotals> = {
  incomeMinor: 0n,
  expenseMinor: 0n,
  transfersOutMinor: 0n,
  transfersInMinor: 0n,
  counted: 0,
};

export function calculateCurrentBalance(openingMinor: bigint, totals: MovementTotals): bigint {
  return (
    openingMinor +
    totals.incomeMinor -
    totals.expenseMinor -
    totals.transfersOutMinor +
    totals.transfersInMinor
  );
}

export interface BalanceSubject {
  type: AccountType;
  openingBalanceMinor: bigint;
  creditLimitMinor: bigint | null;
}

/**
 * The balance figures of one account. Liabilities also report the amount owed (the negated net
 * position), and credit cards with a limit the credit still available.
 */
export function describeAccountBalance(
  subject: BalanceSubject,
  totals: MovementTotals,
): AccountBalanceDto {
  const current = calculateCurrentBalance(subject.openingBalanceMinor, totals);
  const balance: AccountBalanceDto = {
    currentBalanceMinor: serializeMinorUnits(current),
    countedTransactions: totals.counted,
  };
  if (getAccountClassification(subject.type) === 'liability') {
    const owed = -current;
    balance.amountOwedMinor = serializeMinorUnits(owed);
    if (subject.type === 'credit_card' && subject.creditLimitMinor !== null) {
      balance.availableCreditMinor = serializeMinorUnits(subject.creditLimitMinor - owed);
    }
  }
  return balance;
}

export interface SummaryEntry {
  currency: CurrencyCode;
  classification: AccountClassification;
  currentBalanceMinor: bigint;
}

/**
 * Totals per currency: assets (money held) and liabilities (money owed) side by side, never netted
 * against each other and never combined across currencies.
 */
export function summarizeBalances(entries: readonly SummaryEntry[]): AccountSummaryDto {
  const byCurrency = new Map<
    CurrencyCode,
    { assets: bigint; liabilities: bigint; assetAccounts: number; liabilityAccounts: number }
  >();

  for (const entry of entries) {
    const totals = byCurrency.get(entry.currency) ?? {
      assets: 0n,
      liabilities: 0n,
      assetAccounts: 0,
      liabilityAccounts: 0,
    };
    if (entry.classification === 'asset') {
      totals.assets += entry.currentBalanceMinor;
      totals.assetAccounts += 1;
    } else {
      totals.liabilities -= entry.currentBalanceMinor;
      totals.liabilityAccounts += 1;
    }
    byCurrency.set(entry.currency, totals);
  }

  const currencies: CurrencyBalanceSummaryDto[] = [...byCurrency].map(([currency, totals]) => ({
    currency,
    assetsMinor: serializeMinorUnits(totals.assets),
    liabilitiesMinor: serializeMinorUnits(totals.liabilities),
    assetAccounts: totals.assetAccounts,
    liabilityAccounts: totals.liabilityAccounts,
  }));
  return { currencies: currencies.sort((a, b) => a.currency.localeCompare(b.currency)) };
}
