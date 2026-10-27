import { describe, expect, it } from 'vitest';

import {
  countActiveFilters,
  DEFAULT_FILTERS,
  filtersToSearch,
  listQuery,
  periodRange,
  readFilters,
  summaryQuery,
  withFilters,
} from './transaction-filters';

const ACCOUNT = '0193a000-0000-7000-8000-000000000201';
const CATEGORY = '0193a000-0000-7000-8000-000000000101';

describe('readFilters', () => {
  it('reads every supported filter from the URL', () => {
    const filters = readFilters(
      new URLSearchParams(
        `q=fresh&type=expense&accountId=${ACCOUNT}&categoryId=${CATEGORY}&paymentMethod=upi&tags=Family,work&from=2026-10-01&to=2026-10-31&minAmount=10.5&maxAmount=500&status=voided&sort=largest&page=3`,
      ),
    );
    expect(filters).toEqual({
      q: 'fresh',
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      paymentMethod: 'upi',
      tags: ['family', 'work'],
      from: '2026-10-01',
      to: '2026-10-31',
      minAmount: '10.5',
      maxAmount: '500',
      status: 'voided',
      sort: 'largest',
      page: 3,
    });
  });

  it('drops malformed, unsafe, or inverted values instead of passing them on', () => {
    const filters = readFilters(
      new URLSearchParams(
        'type=refund&accountId=1;DROP&sort=amount_minor&page=-2&from=2026-10-31&to=2026-10-01&minAmount=1e3&maxAmount=5&status=deleted&tags=%23bad,ok',
      ),
    );
    expect(filters).toEqual({
      ...DEFAULT_FILTERS,
      from: '2026-10-31',
      maxAmount: '5',
      tags: ['ok'],
    });
  });
});

describe('queries', () => {
  const filters = withFilters(DEFAULT_FILTERS, {
    q: ' fresh ',
    type: 'expense',
    tags: ['family'],
    sort: 'oldest',
    page: 2,
  });

  it('keeps defaults out of the page URL and round-trips', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    const search = filtersToSearch(filters);
    expect(search).toBe('q=fresh&type=expense&tags=family&sort=oldest&page=2');
    expect(readFilters(new URLSearchParams(search))).toEqual({ ...filters, q: 'fresh' });
  });

  it('gives the summary exactly the list’s filters, without paging or order', () => {
    expect(listQuery(filters)).toBe(
      'q=fresh&type=expense&tags=family&sort=oldest&page=2&pageSize=25',
    );
    expect(summaryQuery(filters)).toBe('q=fresh&type=expense&tags=family');
  });

  it('returns to the first page whenever a filter changes', () => {
    expect(withFilters(filters, { type: 'income' }).page).toBe(1);
    expect(withFilters(filters, { page: 4 }).page).toBe(4);
  });

  it('counts narrowing filters only', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, sort: 'largest', page: 3 })).toBe(0);
    expect(countActiveFilters(filters)).toBe(3);
  });
});

describe('periodRange', () => {
  it('builds calendar ranges from the user’s today', () => {
    expect(periodRange('this-month', '2026-10-26')).toEqual({
      from: '2026-10-01',
      to: '2026-10-26',
    });
    expect(periodRange('last-month', '2026-03-15')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(periodRange('last-month', '2026-01-05')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('last-30-days', '2026-10-26')).toEqual({
      from: '2026-09-27',
      to: '2026-10-26',
    });
  });
});
