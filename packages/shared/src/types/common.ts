/** Primary key of a persisted entity: a UUID (version 7, time-ordered). */
export type EntityId = string;

/** ISO 8601 calendar date without time, e.g. `2026-10-25`. */
export type IsoDateString = string;

/** ISO 8601 UTC timestamp with millisecond precision, e.g. `2026-10-25T09:30:00.000Z`. */
export type IsoDateTimeString = string;

/**
 * Integer amount in a currency's minor unit (e.g. paise), serialized as a base-10 string such as
 * `"12550"` for ₹125.50. Strings keep the full PostgreSQL `BIGINT` range exact in JSON.
 */
export type MinorUnitsString = string;

/** IANA time zone identifier, e.g. `Asia/Kolkata`. */
export type TimeZoneId = string;
