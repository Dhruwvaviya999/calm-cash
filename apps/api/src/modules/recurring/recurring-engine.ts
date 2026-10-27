import {
  daysBetween,
  firstUnresolvedOccurrence,
  occurrencesBetween,
  pendingOccurrenceStatus,
  serializeMinorUnits,
  currencyCodeSchema,
  type IsoDateString,
  type OccurrenceDto,
  type RecurrenceRule,
  type RecurringScheduleStatus,
} from '@calmcash/shared';

import { toIsoDate } from '../../lib/calendar-dates';
import type { OccurrenceRecord, ScheduleRecord } from './recurring.repository';

// Pure scheduling logic on top of the shared recurrence engine: a schedule's status, its cursor,
// and which occurrences are still expected. Stored occurrence rows record only what the person
// did (recorded, skipped, postponed, passed over while paused); every other date of the rule is
// pending. Nothing here reads the clock or the database.

export function ruleOf(
  schedule: Pick<ScheduleRecord, 'frequency' | 'interval' | 'startDate' | 'endDate'>,
): RecurrenceRule {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    startDate: toIsoDate(schedule.startDate),
    endDate: schedule.endDate === null ? undefined : toIsoDate(schedule.endDate),
  };
}

export function isResolved(row: Pick<OccurrenceRecord, 'state'> | undefined): boolean {
  return row !== undefined && row.state !== 'postponed';
}

/** Occurrence rows of one schedule, by scheduled date. */
export function rowsByDate(
  rows: readonly OccurrenceRecord[],
): Map<IsoDateString, OccurrenceRecord> {
  return new Map(rows.map((row) => [toIsoDate(row.scheduledDate), row]));
}

/**
 * The cursor: the earliest occurrence of the rule (from its start date) that no stored row
 * resolves. Rows before the start date are history from an earlier timing and are ignored.
 */
export function nextCursor(
  schedule: Pick<ScheduleRecord, 'frequency' | 'interval' | 'startDate' | 'endDate'>,
  rows: ReadonlyMap<IsoDateString, OccurrenceRecord>,
): IsoDateString | undefined {
  const rule = ruleOf(schedule);
  return firstUnresolvedOccurrence(
    rule,
    rule.startDate,
    (date) => isResolved(rows.get(date)),
    rows.size + 1,
  );
}

export function scheduleStatus(
  schedule: Pick<ScheduleRecord, 'archivedAt' | 'pausedAt' | 'nextOccurrenceDate'>,
): RecurringScheduleStatus {
  if (schedule.archivedAt !== null) return 'archived';
  if (schedule.pausedAt !== null) return 'paused';
  if (schedule.nextOccurrenceDate === null) return 'completed';
  return 'active';
}

export interface PendingOccurrence {
  scheduledDate: IsoDateString;
  dueDate: IsoDateString;
  row: OccurrenceRecord | undefined;
}

/**
 * Occurrences still expected, from the cursor up to `until` (by scheduled date), at most `limit`.
 * Paused, archived, and finished schedules expect nothing.
 */
export function pendingOccurrences(
  schedule: ScheduleRecord,
  rows: ReadonlyMap<IsoDateString, OccurrenceRecord>,
  until: IsoDateString,
  limit: number,
): PendingOccurrence[] {
  if (scheduleStatus(schedule) !== 'active' || schedule.nextOccurrenceDate === null) {
    return [];
  }
  const cursor = toIsoDate(schedule.nextOccurrenceDate);
  if (cursor > until) {
    return [];
  }
  const pending: PendingOccurrence[] = [];
  for (const date of occurrencesBetween(ruleOf(schedule), cursor, until, limit + rows.size)) {
    const row = rows.get(date);
    if (isResolved(row)) continue;
    pending.push({
      scheduledDate: date,
      dueDate: row === undefined ? date : toIsoDate(row.dueDate),
      row,
    });
    if (pending.length >= limit) break;
  }
  return pending;
}

export interface OccurrenceSource {
  scheduledDate: IsoDateString;
  dueDate: IsoDateString;
  row: OccurrenceRecord | undefined;
}

/** One occurrence as the API shows it today. */
export function toOccurrenceDto(
  schedule: Pick<ScheduleRecord, 'id' | 'amountMinor' | 'currency' | 'reminderDays'>,
  { scheduledDate, dueDate, row }: OccurrenceSource,
  today: IsoDateString,
): OccurrenceDto {
  const state = row?.state;
  const status =
    state === 'recorded' || state === 'skipped' || state === 'paused'
      ? state
      : pendingOccurrenceStatus(dueDate, today);
  const pending = status === 'upcoming' || status === 'due' || status === 'overdue';
  const transaction = row?.transaction ?? null;
  const transactionId = row?.transactionId ?? null;
  const resolvedAt = row?.resolvedAt ?? null;
  return {
    scheduleId: schedule.id,
    scheduledDate,
    dueDate,
    status,
    postponed: dueDate !== scheduledDate,
    dueSoon:
      status === 'upcoming' &&
      schedule.reminderDays !== null &&
      daysBetween(today, dueDate) <= schedule.reminderDays,
    amountMinor: serializeMinorUnits(
      state === 'recorded' && transaction !== null ? transaction.amountMinor : schedule.amountMinor,
    ),
    currency: currencyCodeSchema.parse(
      state === 'recorded' && transaction !== null ? transaction.currency : schedule.currency,
    ),
    ...(transaction === null || transactionId === null
      ? {}
      : {
          transactionId,
          transactionStatus: transaction.voidedAt === null ? 'active' : 'voided',
        }),
    ...(pending || resolvedAt === null ? {} : { resolvedAt: resolvedAt.toISOString() }),
  };
}

/** The pending occurrence the schedule expects next (the cursor), if any. */
export function nextOccurrenceDto(
  schedule: ScheduleRecord,
  rows: ReadonlyMap<IsoDateString, OccurrenceRecord>,
  today: IsoDateString,
): OccurrenceDto | undefined {
  if (schedule.nextOccurrenceDate === null || schedule.archivedAt !== null) {
    return undefined;
  }
  const scheduledDate = toIsoDate(schedule.nextOccurrenceDate);
  const row = rows.get(scheduledDate);
  if (isResolved(row)) {
    return undefined;
  }
  return toOccurrenceDto(
    schedule,
    { scheduledDate, dueDate: row === undefined ? scheduledDate : toIsoDate(row.dueDate), row },
    today,
  );
}
