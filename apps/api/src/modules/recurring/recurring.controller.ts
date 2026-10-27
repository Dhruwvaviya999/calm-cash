import type {
  CreateRecurringScheduleInput,
  EndRecurringScheduleInput,
  OccurrenceActionResultDto,
  PostponeOccurrenceInput,
  RecordedOccurrenceDto,
  RecordOccurrenceInput,
  RecurringListQuery,
  RecurringScheduleDetailDto,
  RecurringScheduleItemDto,
  RecurringScheduleListDto,
  UpcomingOccurrencesDto,
  UpcomingOccurrencesQuery,
  UpdateRecurringScheduleInput,
} from '@calmcash/shared';

import type { Caller } from '../../lib/auth-boundary';
import type { Handler } from '../../lib/controller';
import { sendSuccess } from '../../lib/http-response';
import type { RecurringService } from './recurring.service';

interface ScheduleParams {
  params: { scheduleId: string };
}

interface OccurrenceParams {
  params: { scheduleId: string; date: string };
}

type ScheduleAction = Handler<ScheduleParams, RecurringScheduleItemDto>;

export interface RecurringController {
  list: Handler<{ query: RecurringListQuery }, RecurringScheduleListDto>;
  upcoming: Handler<{ query: UpcomingOccurrencesQuery }, UpcomingOccurrencesDto>;
  get: Handler<ScheduleParams, RecurringScheduleDetailDto>;
  create: Handler<{ body: CreateRecurringScheduleInput }, RecurringScheduleItemDto>;
  update: Handler<
    ScheduleParams & { body: UpdateRecurringScheduleInput },
    RecurringScheduleItemDto
  >;
  pause: ScheduleAction;
  resume: ScheduleAction;
  end: Handler<ScheduleParams & { body: EndRecurringScheduleInput }, RecurringScheduleItemDto>;
  archive: ScheduleAction;
  restore: ScheduleAction;
  record: Handler<OccurrenceParams & { body: RecordOccurrenceInput }, RecordedOccurrenceDto>;
  skip: Handler<OccurrenceParams, OccurrenceActionResultDto>;
  unskip: Handler<OccurrenceParams, OccurrenceActionResultDto>;
  postpone: Handler<
    OccurrenceParams & { body: PostponeOccurrenceInput },
    OccurrenceActionResultDto
  >;
}

/** Thin HTTP adapter: the caller comes from the session, everything else from validated input. */
export function createRecurringController(
  service: RecurringService,
  getCaller: (req: object) => Caller,
): RecurringController {
  const address = ({
    scheduleId,
    date,
  }: OccurrenceParams['params']): {
    scheduleId: string;
    date: string;
  } => ({ scheduleId, date });

  return {
    list: async ({ query }, req, res) => {
      sendSuccess(res, await service.list(getCaller(req), query));
    },
    upcoming: async ({ query }, req, res) => {
      sendSuccess(res, await service.upcoming(getCaller(req), query));
    },
    get: async ({ params }, req, res) => {
      sendSuccess(res, await service.get(getCaller(req), params.scheduleId));
    },
    create: async ({ body }, req, res) => {
      sendSuccess(res, await service.create(getCaller(req), body), 201);
    },
    update: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.update(getCaller(req), params.scheduleId, body));
    },
    pause: async ({ params }, req, res) => {
      sendSuccess(res, await service.pause(getCaller(req), params.scheduleId));
    },
    resume: async ({ params }, req, res) => {
      sendSuccess(res, await service.resume(getCaller(req), params.scheduleId));
    },
    end: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.end(getCaller(req), params.scheduleId, body));
    },
    archive: async ({ params }, req, res) => {
      sendSuccess(res, await service.archive(getCaller(req), params.scheduleId));
    },
    restore: async ({ params }, req, res) => {
      sendSuccess(res, await service.restore(getCaller(req), params.scheduleId));
    },
    record: async ({ params, body }, req, res) => {
      const outcome = await service.record(getCaller(req), address(params), body);
      // 201 when the money was recorded now; 200 when an earlier request already recorded it.
      sendSuccess(res, outcome.result, outcome.replayed ? 200 : 201);
    },
    skip: async ({ params }, req, res) => {
      sendSuccess(res, await service.skip(getCaller(req), address(params)));
    },
    unskip: async ({ params }, req, res) => {
      sendSuccess(res, await service.unskip(getCaller(req), address(params)));
    },
    postpone: async ({ params, body }, req, res) => {
      sendSuccess(res, await service.postpone(getCaller(req), address(params), body));
    },
  };
}
