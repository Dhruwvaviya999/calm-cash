/**
 * Inclusive bounds of PostgreSQL `BIGINT`, the storage type of every minor-unit amount.
 * Values outside `Number.MAX_SAFE_INTEGER` cannot be represented exactly by JavaScript numbers,
 * which is why amounts travel as decimal strings and are handled as `bigint` in code.
 */
export const MINOR_UNITS_MIN = -9_223_372_036_854_775_808n; // -(2^63)
export const MINOR_UNITS_MAX = 9_223_372_036_854_775_807n; // 2^63 - 1

/**
 * Largest magnitude accepted for an amount a person types (opening balances, credit limits):
 * 999,999,999,999,999 minor units (just under ₹10 trillion). Far above any personal balance, yet
 * thousands of such values can still be summed without leaving the BIGINT range.
 */
export const MAX_ENTERED_AMOUNT_MINOR = 999_999_999_999_999n;
