import { createServer, type Server } from 'node:http';

import type { WorkerStatus } from '@calmcash/api/automation';

// An optional, read-only health endpoint for process supervisors (`GET /health`). It reports only
// operational facts — never user data — and is bound to loopback unless configured otherwise.

export interface HealthReport {
  status: 'ok' | 'starting' | 'stalled' | 'stopped';
  workerId: string;
  startedAt: string;
  cycles: number;
  lastCycleAt?: string;
  lastCycleOk?: boolean;
}

/**
 * `ok` while cycles complete in time; `stalled` when the last cycle is older than `staleAfterMs` or
 * failed; `starting` before the first cycle; `stopped` once the loop has ended.
 */
export function healthReport(status: WorkerStatus, now: Date, staleAfterMs: number): HealthReport {
  const base = {
    workerId: status.workerId,
    startedAt: status.startedAt.toISOString(),
    cycles: status.cycles,
    ...(status.lastCycleAt === undefined ? {} : { lastCycleAt: status.lastCycleAt.toISOString() }),
    ...(status.lastCycleOk === undefined ? {} : { lastCycleOk: status.lastCycleOk }),
  };
  if (!status.running) return { status: 'stopped', ...base };
  if (status.lastCycleAt === undefined) {
    return {
      status: now.getTime() - status.startedAt.getTime() > staleAfterMs ? 'stalled' : 'starting',
      ...base,
    };
  }
  const fresh = now.getTime() - status.lastCycleAt.getTime() <= staleAfterMs;
  return { status: fresh && status.lastCycleOk === true ? 'ok' : 'stalled', ...base };
}

export interface HealthServerOptions {
  host: string;
  port: number;
  staleAfterMs: number;
  status: () => WorkerStatus;
  now?: () => Date;
}

/** Starts the endpoint; resolves once it listens. `close()` it during shutdown. */
export function startHealthServer({
  host,
  port,
  staleAfterMs,
  status,
  now = (): Date => new Date(),
}: HealthServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET' || req.url !== '/health') {
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'not_found' }));
      return;
    }
    const report = healthReport(status(), now(), staleAfterMs);
    res.statusCode = report.status === 'ok' || report.status === 'starting' ? 200 : 503;
    res.end(JSON.stringify(report));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
