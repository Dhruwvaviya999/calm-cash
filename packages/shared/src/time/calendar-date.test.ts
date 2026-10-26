import { describe, expect, it } from 'vitest';

import { calendarDateInTimeZone } from './calendar-date';

describe('calendarDateInTimeZone', () => {
  it('uses the calendar of the given time zone, not UTC', () => {
    const instant = new Date('2026-10-25T20:30:00.000Z');
    expect(calendarDateInTimeZone(instant, 'UTC')).toBe('2026-10-25');
    expect(calendarDateInTimeZone(instant, 'Asia/Kolkata')).toBe('2026-10-26');
    expect(calendarDateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-25');
  });
});
