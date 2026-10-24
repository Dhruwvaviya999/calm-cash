import {
  healthCheckDtoSchema,
  readinessCheckDtoSchema,
  type HealthCheckDto,
  type ReadinessCheckDto,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// Services map one-to-one onto API endpoints and return validated shared DTOs.

export function getLiveness(signal?: AbortSignal): Promise<HealthCheckDto> {
  return api.request('/health', { schema: healthCheckDtoSchema, signal });
}

/** Rejects with an `ApiClientError` coded `SERVICE_UNAVAILABLE` when the database is down. */
export function getReadiness(signal?: AbortSignal): Promise<ReadinessCheckDto> {
  return api.request('/health/ready', { schema: readinessCheckDtoSchema, signal });
}
