import type { IsoDateTimeString } from './common';

/** Liveness: the API process is running and able to serve requests. */
export interface HealthCheckDto {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: IsoDateTimeString;
}

/** Readiness: the API and the dependencies it needs (the database) are available. */
export interface ReadinessCheckDto {
  status: 'ok';
  checks: {
    database: 'up';
  };
  timestamp: IsoDateTimeString;
}
