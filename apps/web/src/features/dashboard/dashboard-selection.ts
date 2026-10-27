import {
  currencyCodeSchema,
  dashboardQuerySchema,
  DEFAULT_DASHBOARD_PERIOD,
  type CurrencyCode,
  type DashboardQuery,
} from '@calmcash/shared';

// The dashboard's period and currency live in the page URL (`?period=last-month&currency=USD`),
// so a refresh or a shared link restores the same view. Only a preset name, two calendar dates,
// and a currency code ever appear there. Malformed parameters fall back to the defaults.

export type DashboardSelection = DashboardQuery;

export const DEFAULT_SELECTION: DashboardSelection = { period: DEFAULT_DASHBOARD_PERIOD };

interface ReadableParams {
  get: (name: string) => string | null;
}

function present(params: ReadableParams, name: string): Record<string, string> {
  const value = params.get(name);
  return value === null || value === '' ? {} : { [name]: value };
}

export function readSelection(params: ReadableParams): DashboardSelection {
  const candidate = {
    ...present(params, 'period'),
    ...present(params, 'from'),
    ...present(params, 'to'),
    ...present(params, 'currency'),
  };
  const parsed = dashboardQuerySchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  // Keep a valid currency even when the period is unusable.
  const currency = currencyCodeSchema.safeParse(params.get('currency'));
  return currency.success ? { ...DEFAULT_SELECTION, currency: currency.data } : DEFAULT_SELECTION;
}

/** Query string shared by the page URL and the API (defaults omitted, so URLs stay short). */
export function selectionToQuery(selection: DashboardSelection): string {
  const params = new URLSearchParams();
  if (selection.period !== DEFAULT_DASHBOARD_PERIOD) {
    params.set('period', selection.period);
  }
  if (selection.period === 'custom') {
    if (selection.from !== undefined) params.set('from', selection.from);
    if (selection.to !== undefined) params.set('to', selection.to);
  }
  if (selection.currency !== undefined) {
    params.set('currency', selection.currency);
  }
  return params.toString();
}

export function withCurrency(
  selection: DashboardSelection,
  currency: CurrencyCode,
): DashboardSelection {
  return { ...selection, currency };
}
