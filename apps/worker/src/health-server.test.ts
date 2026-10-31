import type { WorkerStatus } from '@calmcash/api/automation';
import { afterEach, describe, expect, it } from 'vitest';

import { healthReport, startHealthServer } from './health-server';
import { workerIdFor } from './worker-id';

const STARTED = new Date('2026-10-31T08:00:00.000Z');

function status(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    workerId: 'host:1:abcd',
    startedAt: STARTED,
    running: true,
    cycles: 0,
    lastCycleAt: undefined,
    lastCycleOk: undefined,
    ...overrides,
  };
}

const at = (seconds: number): Date => new Date(STARTED.getTime() + seconds * 1000);

describe('healthReport', () => {
  it('is starting before the first cycle, then stalled if no cycle ever finishes', () => {
    expect(healthReport(status(), at(10), 60_000).status).toBe('starting');
    expect(healthReport(status(), at(120), 60_000).status).toBe('stalled');
  });

  it('is ok while cycles finish in time, stalled when they stop or fail', () => {
    const recent = status({ cycles: 3, lastCycleAt: at(50), lastCycleOk: true });
    expect(healthReport(recent, at(60), 60_000)).toMatchObject({ status: 'ok', cycles: 3 });
    expect(healthReport(recent, at(200), 60_000).status).toBe('stalled');
    const failed = status({ cycles: 3, lastCycleAt: at(50), lastCycleOk: false });
    expect(healthReport(failed, at(60), 60_000).status).toBe('stalled');
  });

  it('is stopped once the loop has ended', () => {
    expect(healthReport(status({ running: false }), at(1), 60_000).status).toBe('stopped');
  });
});

describe('startHealthServer', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('answers GET /health on loopback and nothing else', async () => {
    const server = await startHealthServer({
      host: '127.0.0.1',
      port: 0,
      staleAfterMs: 60_000,
      status: () => status({ cycles: 1, lastCycleAt: at(5), lastCycleOk: true }),
      now: () => at(10),
    });
    close = () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The health server is not listening on a TCP port.');
    }
    const base = `http://127.0.0.1:${address.port.toString()}`;

    const ok = await fetch(`${base}/health`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toMatchObject({ status: 'ok', workerId: 'host:1:abcd', cycles: 1 });

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });
});

describe('workerIdFor', () => {
  it('is unique per process and safe to log', () => {
    expect(workerIdFor('build-01.internal', 4242, 'deadbeef')).toBe(
      'build-01.internal:4242:deadbeef',
    );
    expect(workerIdFor('host with spaces;rm', 1, 'aa')).toBe('host-with-spaces-rm:1:aa');
    expect(workerIdFor('x'.repeat(200), 1, 'aa').length).toBeLessThanOrEqual(100);
    expect(workerIdFor('h', 1)).not.toBe(workerIdFor('h', 1));
  });
});
