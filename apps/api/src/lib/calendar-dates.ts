// PostgreSQL `date` columns travel through Prisma as `Date` values at UTC midnight. These helpers
// convert them to and from the `YYYY-MM-DD` calendar dates used everywhere else, without any time
// zone arithmetic (a calendar date is the same in every zone).

/** `YYYY-MM-DD` of a PostgreSQL `date` column (Prisma returns it as UTC midnight). */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** UTC midnight of a `YYYY-MM-DD` calendar date, for a `date` column. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
