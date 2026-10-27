// Ratios between exact amounts, in basis points (1 bp = 0.01 percentage point), computed with
// `bigint` only. Rounding to a whole basis point (half away from zero) is the only rounding; the
// web app rounds again, to one decimal place, purely for display. Results travel as canonical
// integer strings, because a ratio of two large amounts can exceed JavaScript's safe integers.

const BASIS_POINTS = 10_000n;

/** `numerator / denominator` rounded to the nearest integer, halves away from zero. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero.');
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

/**
 * Cash-flow savings rate: (income − expenses) ÷ income. `undefined` without income, where the
 * ratio does not exist. Negative when more went out than came in; never clamped.
 */
export function savingsRateBasisPoints(
  incomeMinor: bigint,
  expenseMinor: bigint,
): bigint | undefined {
  if (incomeMinor <= 0n) {
    return undefined;
  }
  return divideRounded((incomeMinor - expenseMinor) * BASIS_POINTS, incomeMinor);
}

/**
 * Relative change from `previous` to `current`. `undefined` when the previous value is zero or
 * negative, where a percentage would be meaningless (a net figure crossing zero, say).
 */
export function percentChangeBasisPoints(
  currentMinor: bigint,
  previousMinor: bigint,
): bigint | undefined {
  if (previousMinor <= 0n) {
    return undefined;
  }
  return divideRounded((currentMinor - previousMinor) * BASIS_POINTS, previousMinor);
}

/** Share of `part` in `total`; 0 when there is no total. */
export function shareBasisPoints(partMinor: bigint, totalMinor: bigint): bigint {
  return totalMinor <= 0n ? 0n : divideRounded(partMinor * BASIS_POINTS, totalMinor);
}
