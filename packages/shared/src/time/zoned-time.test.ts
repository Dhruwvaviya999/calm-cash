import { describe, expect, it } from 'vitest';

import {
  addDaysToIsoDate,
  instantToZonedDateTime,
  startOfDayInTimeZone,
  zonedDateTimeToInstant,
} from './zoned-time';

const iso = (date: Date): string => date.toISOString();

describe('zonedDateTimeToInstant', () => {
  it('converts wall-clock time in the user’s zone, not the computer’s', () => {
    expect(iso(zonedDateTimeToInstant('2026-10-26', '00:15', 'Asia/Kolkata'))).toBe(
      '2026-10-25T18:45:00.000Z',
    );
    expect(iso(zonedDateTimeToInstant('2026-10-26', '23:59', 'Asia/Kolkata'))).toBe(
      '2026-10-26T18:29:00.000Z',
    );
    expect(iso(zonedDateTimeToInstant('2026-10-26', '09:30', 'UTC'))).toBe(
      '2026-10-26T09:30:00.000Z',
    );
  });

  it('handles both sides of a daylight-saving change', () => {
    // New York: EDT (UTC−4) until 1 Nov 2026 02:00, then EST (UTC−5).
    expect(iso(zonedDateTimeToInstant('2026-10-31', '12:00', 'America/New_York'))).toBe(
      '2026-10-31T16:00:00.000Z',
    );
    expect(iso(zonedDateTimeToInstant('2026-11-02', '12:00', 'America/New_York'))).toBe(
      '2026-11-02T17:00:00.000Z',
    );
  });

  it('resolves a repeated hour to its first occurrence', () => {
    // 01:30 happens twice on 1 Nov 2026 in New York (EDT, then EST).
    expect(iso(zonedDateTimeToInstant('2026-11-01', '01:30', 'America/New_York'))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('moves a skipped time forward by the size of the jump', () => {
    // 02:30 does not exist on 8 Mar 2026 in New York; it resolves to 03:30 EDT.
    expect(iso(zonedDateTimeToInstant('2026-03-08', '02:30', 'America/New_York'))).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('rejects malformed input', () => {
    expect(() => zonedDateTimeToInstant('26-10-2026', '10:00', 'UTC')).toThrow(RangeError);
    expect(() => zonedDateTimeToInstant('2026-10-26', '24:00', 'UTC')).toThrow(RangeError);
    expect(() => zonedDateTimeToInstant('2026-10-26', '9:30', 'UTC')).toThrow(RangeError);
  });
});

describe('instantToZonedDateTime', () => {
  it('shows the calendar day and time of the user’s zone', () => {
    const instant = new Date('2026-10-25T20:30:00.000Z');
    expect(instantToZonedDateTime(instant, 'Asia/Kolkata')).toEqual({
      date: '2026-10-26',
      time: '02:00',
    });
    expect(instantToZonedDateTime(instant, 'America/Los_Angeles')).toEqual({
      date: '2026-10-25',
      time: '13:30',
    });
  });

  it('round-trips with zonedDateTimeToInstant', () => {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Kathmandu']) {
      const instant = zonedDateTimeToInstant('2026-07-04', '18:45', zone);
      expect(instantToZonedDateTime(instant, zone)).toEqual({ date: '2026-07-04', time: '18:45' });
    }
  });
});

describe('startOfDayInTimeZone and addDaysToIsoDate', () => {
  it('finds midnight in the zone, which can be the previous UTC day', () => {
    expect(iso(startOfDayInTimeZone('2026-10-01', 'Asia/Kolkata'))).toBe(
      '2026-09-30T18:30:00.000Z',
    );
  });

  it('gives days of 23 and 25 hours around daylight-saving changes', () => {
    const zone = 'America/New_York';
    const hours = (date: string): number =>
      (startOfDayInTimeZone(addDaysToIsoDate(date, 1), zone).getTime() -
        startOfDayInTimeZone(date, zone).getTime()) /
      3_600_000;
    expect(hours('2026-03-08')).toBe(23);
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2026-11-02')).toBe(24);
  });

  it('adds calendar days across month and year ends', () => {
    expect(addDaysToIsoDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToIsoDate('2028-03-01', -1)).toBe('2028-02-29');
  });
});
