import type { RecurringScheduleDto } from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import { describeDue, describeFrequency } from './recurring-presentation';
import {
  buildCreateScheduleInput,
  buildUpdateScheduleInput,
  emptyScheduleFormValues,
  scheduleToFormValues,
} from './schedule-form-model';

const schedule: RecurringScheduleDto = {
  id: '0193a000-0000-7000-8000-000000000501',
  userId: '0193a000-0000-7000-8000-000000000001',
  name: 'Rent',
  type: 'expense',
  amountMinor: '2500000',
  currency: 'INR',
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-31',
  status: 'active',
  nextOccurrenceDate: '2026-10-31',
  isSubscription: false,
  createdAt: '2026-01-01T04:30:00.000Z',
  updatedAt: '2026-01-01T04:30:00.000Z',
};

describe('schedule form model', () => {
  it('builds an exact schedule from a preset rhythm', () => {
    const built = buildCreateScheduleInput({
      ...emptyScheduleFormValues('INR', 'Asia/Kolkata'),
      name: 'Rent',
      amount: '25000',
      repeat: 'monthly:3',
      startDate: '2026-11-01',
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input).toMatchObject({
        amountMinor: '2500000',
        frequency: 'monthly',
        interval: 3,
        reminderDays: 3,
      });
    }
  });

  it('validates custom intervals and amounts', () => {
    const built = buildCreateScheduleInput({
      ...emptyScheduleFormValues('JPY', 'Asia/Kolkata'),
      name: 'Gym',
      amount: '500.5',
      repeat: 'custom',
      frequency: 'monthly',
      interval: '30',
      startDate: '2026-11-01',
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors.amount).toContain('no decimal places');
      expect(built.errors.interval).toBeDefined();
    }
  });

  it('sends only changed fields', () => {
    const values = scheduleToFormValues(schedule);
    expect(values.repeat).toBe('monthly:1');
    expect(buildUpdateScheduleInput(schedule, values)).toEqual({ ok: true, input: undefined });
    expect(buildUpdateScheduleInput(schedule, { ...values, amount: '26000' })).toEqual({
      ok: true,
      input: { amountMinor: '2600000' },
    });
  });
});

describe('recurring presentation', () => {
  it('explains month-end and leap-day schedules', () => {
    expect(describeFrequency(schedule)).toBe('Every month on the 31st (or the month’s last day)');
    expect(
      describeFrequency({ ...schedule, frequency: 'weekly', interval: 2, startDate: '2026-10-30' }),
    ).toBe('Every 2 weeks on Friday');
    expect(
      describeFrequency({ ...schedule, frequency: 'yearly', startDate: '2028-02-29' }),
    ).toContain('28 Feb in other years');
  });

  it('describes due dates relative to today', () => {
    expect(describeDue('2026-10-27', '2026-10-27')).toBe('Today');
    expect(describeDue('2026-10-28', '2026-10-27')).toBe('Tomorrow');
    expect(describeDue('2026-10-20', '2026-10-27')).toBe('7 days ago');
  });
});
