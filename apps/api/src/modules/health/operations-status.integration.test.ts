import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createErrorHandler } from '../../middleware/error-handler';
import { useIntegrationDatabase } from '../../testing/integration-harness';
import { createHealthRouter } from './health.routes';
import { createOperationsStatusReader, type OperationsStatusDto } from './operations-status';

const { prisma } = useIntegrationDatabase();
const TOKEN = 'ops-token-for-tests-0123456789abcdef';
const NOW = new Date('2026-11-04T12:00:00.000Z');

function reader(now = NOW): () => Promise<OperationsStatusDto> {
  return createOperationsStatusReader({
    prisma,
    receiptStorageProvider: 'vercel-blob',
    emailMode: 'smtp',
    aiEnabled: false,
    now: () => now,
  });
}

function app(): express.Express {
  const server = express();
  server.use(
    '/api/v1/health',
    createHealthRouter({
      checkDatabase: () => Promise.resolve(true),
      operations: { token: TOKEN, read: reader() },
    }),
  );
  server.use(createErrorHandler());
  return server;
}

describe('operator status', () => {
  it('reports a missing worker as degraded, not down', async () => {
    const report = await reader()();
    expect(report).toMatchObject({
      status: 'degraded',
      database: { status: 'up' },
      worker: { status: 'never_seen' },
      jobs: { pending: 0, processing: 0, failed: 0, oldestDueSecondsAgo: 0 },
      receiptStorage: { provider: 'vercel-blob' },
      email: { mode: 'smtp' },
      ai: { enabled: false },
    });
  });

  it('tells a running worker from a stale one and measures the queue', async () => {
    await prisma.workerHeartbeat.create({
      data: { id: 'w1', startedAt: NOW, lastSeenAt: new Date(NOW.getTime() - 60_000) },
    });
    await prisma.automationJob.create({
      data: {
        kind: 'maintenance',
        payload: { v: 1, date: '2026-11-04' },
        runAt: new Date(NOW.getTime() - 600_000),
      },
    });

    const running = await reader()();
    expect(running.status).toBe('ok');
    expect(running.worker).toEqual({ status: 'running', lastSeenSecondsAgo: 60 });
    expect(running.jobs).toMatchObject({ pending: 1, oldestDueSecondsAgo: 600 });

    const later = await reader(new Date(NOW.getTime() + 10 * 60_000))();
    expect(later.status).toBe('degraded');
    expect(later.worker.status).toBe('stale');
  });

  it('answers only with the token, and like an unknown route otherwise', async () => {
    const missing = await request(app()).get('/api/v1/health/status').expect(404);
    const wrong = await request(app())
      .get('/api/v1/health/status')
      .set('Authorization', 'Bearer not-the-token')
      .expect(404);
    expect(wrong.body).toEqual(missing.body);

    const ok = await request(app())
      .get('/api/v1/health/status')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    expect(ok.get('Cache-Control')).toBe('no-store');
    const text = JSON.stringify(ok.body);
    for (const secret of ['postgres', 'localhost', TOKEN, 'password']) {
      expect(text).not.toContain(secret);
    }
  });
});
