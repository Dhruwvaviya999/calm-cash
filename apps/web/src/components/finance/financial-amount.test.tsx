import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { directionForTransactionType, FinancialAmount } from './financial-amount';

/** Visible text only: what a sighted user reads (screen-reader-only text removed). */
function visibleText(markup: string): string {
  return markup
    .replace(/<span class="sr-only">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
}

describe('FinancialAmount', () => {
  it('shows credits with a plus sign and announces them as credits', () => {
    const markup = renderToStaticMarkup(
      <FinancialAmount amountMinor="1800000" currency="INR" direction="credit" />,
    );
    expect(visibleText(markup)).toBe('+₹18,000.00');
    expect(markup).toContain('<span class="sr-only">Credit </span>');
    expect(markup).toContain('text-income');
  });

  it('shows debits with a minus sign, independent of colour', () => {
    const markup = renderToStaticMarkup(
      <FinancialAmount amountMinor="245000" currency="INR" direction="debit" />,
    );
    expect(visibleText(markup)).toBe('−₹2,450.00');
    expect(markup).toContain('<span class="sr-only">Debit </span>');
  });

  it('shows signed balances and labels negative ones', () => {
    const markup = renderToStaticMarkup(<FinancialAmount amountMinor="-1834900" currency="INR" />);
    expect(visibleText(markup)).toBe('−₹18,349.00');
    expect(markup).toContain('<span class="sr-only">Negative </span>');
  });

  it('renders the display size from locale parts without changing the value', () => {
    const markup = renderToStaticMarkup(
      <FinancialAmount amountMinor="20407600" currency="INR" size="display" />,
    );
    expect(visibleText(markup)).toBe('₹2,04,076.00');
    expect(markup).toContain('text-[0.55em]');
  });

  it('maps every transaction type to a direction', () => {
    expect(directionForTransactionType('income')).toBe('credit');
    expect(directionForTransactionType('expense')).toBe('debit');
    expect(directionForTransactionType('transfer')).toBe('transfer');
  });
});
