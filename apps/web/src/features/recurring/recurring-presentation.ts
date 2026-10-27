import {
  daysInMonth,
  type IsoDateString,
  type OccurrenceDto,
  type OccurrenceStatus,
  type RecurringFrequency,
  type RecurringScheduleDto,
  type RecurringScheduleStatus,
} from '@calmcash/shared';

import type { StatusTone } from '@/components/feedback/status-badge';
import { formatDate } from '@/lib/format';

// How schedules and occurrences are described. Dates are calendar dates in the user's time zone,
// computed by the API; this module only chooses words and tones.

export const OCCURRENCE_STATUS_PRESENTATION: Readonly<
  Record<OccurrenceStatus, { label: string; tone: StatusTone }>
> = {
  upcoming: { label: 'Upcoming', tone: 'upcoming' },
  due: { label: 'Due today', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'negative' },
  recorded: { label: 'Recorded', tone: 'positive' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  paused: { label: 'Paused then', tone: 'neutral' },
};

export const SCHEDULE_STATUS_PRESENTATION: Readonly<
  Record<RecurringScheduleStatus, { label: string; tone: StatusTone }>
> = {
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'neutral' },
  completed: { label: 'Ended', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${String(day)}th`;
  switch (day % 10) {
    case 1:
      return `${String(day)}st`;
    case 2:
      return `${String(day)}nd`;
    case 3:
      return `${String(day)}rd`;
    default:
      return `${String(day)}th`;
  }
}

const UNITS: Readonly<Record<RecurringFrequency, [string, string]>> = {
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

/** "Every month on the 31st (last day in shorter months)", "Every 2 weeks on Friday", … */
export function describeFrequency(
  schedule: Pick<RecurringScheduleDto, 'frequency' | 'interval' | 'startDate'>,
): string {
  const [one, many] = UNITS[schedule.frequency];
  const every =
    schedule.interval === 1
      ? `Every ${one}`
      : schedule.interval === 3 && schedule.frequency === 'monthly'
        ? 'Every 3 months'
        : `Every ${String(schedule.interval)} ${many}`;
  const [year, month, day] = schedule.startDate.split('-').map(Number);
  switch (schedule.frequency) {
    case 'weekly': {
      const weekday = new Date(`${schedule.startDate}T12:00:00.000Z`).getUTCDay();
      return `${every} on ${WEEKDAYS[weekday] ?? ''}`;
    }
    case 'monthly':
      return day !== undefined && day > 28
        ? `${every} on the ${ordinal(day)} (or the month’s last day)`
        : `${every} on the ${ordinal(day ?? 1)}`;
    case 'yearly': {
      const leapDay =
        month === 2 && day === 29 && year !== undefined && daysInMonth(year, 2) === 29;
      return `${every} on ${formatDate(schedule.startDate, 'dayMonth')}${leapDay ? ' (28 Feb in other years)' : ''}`;
    }
  }
}

/** "Today", "Tomorrow", "In 5 days", "3 days ago". */
export function describeDue(dueDate: IsoDateString, today: IsoDateString): string {
  const days = Math.round(
    (Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${String(days)} days` : `${String(-days)} days ago`;
}

export function isPendingOccurrence(occurrence: OccurrenceDto): boolean {
  return (
    occurrence.status === 'upcoming' ||
    occurrence.status === 'due' ||
    occurrence.status === 'overdue'
  );
}

/** Stable key of an occurrence: its schedule and scheduled date. */
export function occurrenceKey(
  occurrence: Pick<OccurrenceDto, 'scheduleId' | 'scheduledDate'>,
): string {
  return `${occurrence.scheduleId}:${occurrence.scheduledDate}`;
}
