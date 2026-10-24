import type { ApiSuccessResponse, HealthCheckDto, ReadinessCheckDto } from '@calmcash/shared';
import type { Request, Response } from 'express';

import { AppError } from '../../lib/app-error';
import { sendSuccess } from '../../lib/http-response';
import type { HealthService } from './health.service';

export interface HealthController {
  getLiveness: (req: Request, res: Response<ApiSuccessResponse<HealthCheckDto>>) => void;
  getReadiness: (
    req: Request,
    res: Response<ApiSuccessResponse<ReadinessCheckDto>>,
  ) => Promise<void>;
}

/** Thin HTTP adapter: translates service results into responses; holds no logic of its own. */
export function createHealthController(service: HealthService): HealthController {
  return {
    getLiveness: (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, service.getLiveness());
    },

    getReadiness: async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const result = await service.getReadiness();
      if (!result.ready) {
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'The service is not ready to handle requests.',
        );
      }
      sendSuccess(res, result.report);
    },
  };
}
