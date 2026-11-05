import {
  occurrenceActionResultDtoSchema,
  occurrenceLinkCandidatesDtoSchema,
  recordedOccurrenceDtoSchema,
  recurringScheduleDetailDtoSchema,
  recurringScheduleItemDtoSchema,
  recurringScheduleListDtoSchema,
  upcomingOccurrencesDtoSchema,
  type CreateRecurringScheduleInput,
  type EntityId,
  type IsoDateString,
  type OccurrenceActionResultDto,
  type OccurrenceLinkCandidatesDto,
  type RecordedOccurrenceDto,
  type RecordOccurrenceInput,
  type RecurringScheduleDetailDto,
  type RecurringScheduleItemDto,
  type RecurringScheduleListDto,
  type UpcomingOccurrencesDto,
  type UpdateRecurringScheduleInput,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per recurring endpoint; every response is validated against the shared schema.
// Schedules are plans: only `recordOccurrence` records a real transaction (`linkOccurrence` settles
// a payment with a transaction that already exists, so it records nothing new).

function schedulePath(scheduleId: EntityId): `/${string}` {
  return `/recurring/${encodeURIComponent(scheduleId)}`;
}

function occurrencePath(scheduleId: EntityId, date: IsoDateString, action: string): `/${string}` {
  return `${schedulePath(scheduleId)}/occurrences/${encodeURIComponent(date)}/${action}`;
}

export function listSchedules(
  query: string,
  signal?: AbortSignal,
): Promise<RecurringScheduleListDto> {
  return api.request(`/recurring${query === '' ? '' : `?${query}`}`, {
    schema: recurringScheduleListDtoSchema,
    signal,
  });
}

export function getUpcomingOccurrences(
  query: string,
  signal?: AbortSignal,
): Promise<UpcomingOccurrencesDto> {
  return api.request(`/recurring/upcoming${query === '' ? '' : `?${query}`}`, {
    schema: upcomingOccurrencesDtoSchema,
    signal,
  });
}

export function getSchedule(
  scheduleId: EntityId,
  signal?: AbortSignal,
): Promise<RecurringScheduleDetailDto> {
  return api.request(schedulePath(scheduleId), {
    schema: recurringScheduleDetailDtoSchema,
    signal,
  });
}

export function createSchedule(
  input: CreateRecurringScheduleInput,
): Promise<RecurringScheduleItemDto> {
  return api.request('/recurring', {
    schema: recurringScheduleItemDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateSchedule(
  scheduleId: EntityId,
  input: UpdateRecurringScheduleInput,
): Promise<RecurringScheduleItemDto> {
  return api.request(schedulePath(scheduleId), {
    schema: recurringScheduleItemDtoSchema,
    method: 'PATCH',
    body: input,
  });
}

export type ScheduleAction = 'pause' | 'resume' | 'archive' | 'restore';

export function changeSchedule(
  scheduleId: EntityId,
  action: ScheduleAction,
): Promise<RecurringScheduleItemDto> {
  return api.request(`${schedulePath(scheduleId)}/${action}`, {
    schema: recurringScheduleItemDtoSchema,
    method: 'POST',
  });
}

export function endSchedule(
  scheduleId: EntityId,
  endDate?: IsoDateString,
): Promise<RecurringScheduleItemDto> {
  return api.request(`${schedulePath(scheduleId)}/end`, {
    schema: recurringScheduleItemDtoSchema,
    method: 'POST',
    body: endDate === undefined ? {} : { endDate },
  });
}

/** Records the real transaction. Repeating it returns the transaction recorded the first time. */
export function recordOccurrence(
  scheduleId: EntityId,
  date: IsoDateString,
  input: RecordOccurrenceInput,
): Promise<RecordedOccurrenceDto> {
  return api.request(occurrencePath(scheduleId, date, 'record'), {
    schema: recordedOccurrenceDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function skipOccurrence(
  scheduleId: EntityId,
  date: IsoDateString,
  action: 'skip' | 'unskip' = 'skip',
): Promise<OccurrenceActionResultDto> {
  return api.request(occurrencePath(scheduleId, date, action), {
    schema: occurrenceActionResultDtoSchema,
    method: 'POST',
  });
}

export function postponeOccurrence(
  scheduleId: EntityId,
  date: IsoDateString,
  dueDate: IsoDateString,
): Promise<OccurrenceActionResultDto> {
  return api.request(occurrencePath(scheduleId, date, 'postpone'), {
    schema: occurrenceActionResultDtoSchema,
    method: 'POST',
    body: { dueDate },
  });
}

/** Existing transactions that could settle this payment, closest amount and date first. */
export function getLinkCandidates(
  scheduleId: EntityId,
  date: IsoDateString,
  signal?: AbortSignal,
): Promise<OccurrenceLinkCandidatesDto> {
  return api.request(occurrencePath(scheduleId, date, 'link-candidates'), {
    schema: occurrenceLinkCandidatesDtoSchema,
    signal,
  });
}

/** Settles the payment with an existing transaction. Repeating it changes nothing. */
export function linkOccurrence(
  scheduleId: EntityId,
  date: IsoDateString,
  transactionId: EntityId,
): Promise<RecordedOccurrenceDto> {
  return api.request(occurrencePath(scheduleId, date, 'link'), {
    schema: recordedOccurrenceDtoSchema,
    method: 'POST',
    body: { transactionId },
  });
}
