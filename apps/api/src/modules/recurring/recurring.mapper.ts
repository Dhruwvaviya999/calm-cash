import {
  currencyCodeSchema,
  serializeMinorUnits,
  type IsoDateString,
  type RecurringScheduleDto,
  type RecurringScheduleItemDto,
  type RecurringType,
  type TransactionAccountRefDto,
} from '@calmcash/shared';

import { toIsoDate } from '../../lib/calendar-dates';
import type { Account } from '../../generated/prisma/client';
import { toPlanningCategoryRef } from '../categories';
import { nextOccurrenceDto, scheduleStatus } from './recurring-engine';
import type { OccurrenceRecord, ScheduleRecord, ScheduleWithRefs } from './recurring.repository';

// Database rows → public DTOs, field by field: `null` columns become absent properties, money
// becomes canonical strings, dates become `YYYY-MM-DD`.

function recurringType(type: ScheduleRecord['type']): RecurringType {
  if (type === 'income' || type === 'expense') {
    return type;
  }
  throw new Error('Stored schedule violates its type invariant.');
}

export function toScheduleDto(schedule: ScheduleRecord): RecurringScheduleDto {
  return {
    id: schedule.id,
    userId: schedule.userId,
    name: schedule.name,
    type: recurringType(schedule.type),
    amountMinor: serializeMinorUnits(schedule.amountMinor),
    currency: currencyCodeSchema.parse(schedule.currency),
    ...(schedule.accountId === null ? {} : { accountId: schedule.accountId }),
    ...(schedule.categoryId === null ? {} : { categoryId: schedule.categoryId }),
    ...(schedule.merchant === null ? {} : { merchant: schedule.merchant }),
    ...(schedule.paymentMethod === null ? {} : { paymentMethod: schedule.paymentMethod }),
    ...(schedule.notes === null ? {} : { notes: schedule.notes }),
    frequency: schedule.frequency,
    interval: schedule.interval,
    startDate: toIsoDate(schedule.startDate),
    ...(schedule.endDate === null ? {} : { endDate: toIsoDate(schedule.endDate) }),
    ...(schedule.reminderDays === null ? {} : { reminderDays: schedule.reminderDays }),
    status: scheduleStatus(schedule),
    ...(schedule.nextOccurrenceDate === null
      ? {}
      : { nextOccurrenceDate: toIsoDate(schedule.nextOccurrenceDate) }),
    isSubscription: schedule.isSubscription,
    ...(schedule.pausedAt === null ? {} : { pausedAt: schedule.pausedAt.toISOString() }),
    ...(schedule.cancelledAt === null ? {} : { cancelledAt: schedule.cancelledAt.toISOString() }),
    ...(schedule.archivedAt === null ? {} : { archivedAt: schedule.archivedAt.toISOString() }),
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

export function toAccountRef(account: Account): TransactionAccountRefDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: currencyCodeSchema.parse(account.currency),
    status: account.archivedAt === null ? 'active' : 'archived',
  };
}

/** The schedule with its references and the occurrence it expects next. */
export function toScheduleItemDto(
  schedule: ScheduleWithRefs,
  rows: ReadonlyMap<IsoDateString, OccurrenceRecord>,
  today: IsoDateString,
): RecurringScheduleItemDto {
  const next = nextOccurrenceDto(schedule, rows, today);
  return {
    schedule: toScheduleDto(schedule),
    ...(schedule.account === null ? {} : { account: toAccountRef(schedule.account) }),
    ...(schedule.category === null ? {} : { category: toPlanningCategoryRef(schedule.category) }),
    ...(next === undefined ? {} : { nextOccurrence: next }),
  };
}
