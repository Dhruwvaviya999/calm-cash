/**
 * ISO 4217 alphabetic codes of the currencies CalmCash supports.
 * The database stores any `CHAR(3)` code; the API only accepts codes from this list.
 */
export const CURRENCY_CODES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'KWD'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyDefinition {
  readonly code: CurrencyCode;
  readonly name: string;
  /**
   * ISO 4217 exponent: decimal places between the major and minor unit.
   * INR has 2 (₹1 = 100 paise), JPY has 0, KWD has 3.
   */
  readonly minorUnitDigits: 0 | 2 | 3;
}

export const CURRENCIES = {
  INR: { code: 'INR', name: 'Indian Rupee', minorUnitDigits: 2 },
  USD: { code: 'USD', name: 'US Dollar', minorUnitDigits: 2 },
  EUR: { code: 'EUR', name: 'Euro', minorUnitDigits: 2 },
  GBP: { code: 'GBP', name: 'Pound Sterling', minorUnitDigits: 2 },
  AED: { code: 'AED', name: 'UAE Dirham', minorUnitDigits: 2 },
  SGD: { code: 'SGD', name: 'Singapore Dollar', minorUnitDigits: 2 },
  JPY: { code: 'JPY', name: 'Japanese Yen', minorUnitDigits: 0 },
  KWD: { code: 'KWD', name: 'Kuwaiti Dinar', minorUnitDigits: 3 },
} as const satisfies Readonly<Record<CurrencyCode, CurrencyDefinition>>;

export const DEFAULT_CURRENCY: CurrencyCode = 'INR';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
