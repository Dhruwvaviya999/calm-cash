import { apiErrorResponseSchema, API_V1_PREFIX } from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { runMaintenance } from '../automation/maintenance';
import { createPrismaDeliveryStore } from '../automation/delivery-store';
import { createPrismaJobStore } from '../automation/job-store';
import {
  createVerifiedUser,
  fromApp,
  signIn,
  useIntegrationDatabase,
} from '../testing/integration-harness';
import { createPostgresRateLimitStores, rateLimitKeyHash } from './rate-limit';

const AUTH = `${API_V1_PREFIX}/auth`;
const { prisma, createContext } = useIntegrationDatabase();

describe('PostgreSQL rate-limit store', () => {
  it('counts concurrent hits atomically', async () => {
    const store = createPostgresRateLimitStores(prisma)('test.concurrent', 60_000);
    const results = await Promise.all(
      Array.from({ length: 40 }, async () => store.increment('ip:203.0.113.7')),
    );

    const counts = results.map((result) => result.totalHits).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(new Set(results.map((result) => result.resetTime?.getTime())).size).toBe(1);
    expect((await store.get?.('ip:203.0.113.7'))?.totalHits).toBe(40);
  });

  it('starts a new window once the previous one has ended', async () => {
    const store = createPostgresRateLimitStores(prisma)('test.window', 60_000);
    await store.increment('user:a');
    await store.increment('user:a');
    await prisma.rateLimitCounter.updateMany({ data: { resetAt: new Date(Date.now() - 1_000) } });

    expect(await store.get?.('user:a')).toBeUndefined();
    const restarted = await store.increment('user:a');
    expect(restarted.totalHits).toBe(1);
    expect(restarted.resetTime?.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('never goes below zero and resets keys', async () => {
    const store = createPostgresRateLimitStores(prisma)('test.decrement', 60_000);
    await store.increment('k');
    await store.decrement('k');
    await store.decrement('k');
    expect((await store.get?.('k'))?.totalHits).toBe(0);

    await store.increment('k');
    await store.resetKey('k');
    expect(await store.get?.('k')).toBeUndefined();
  });

  it('keeps limiters with the same subject apart and stores no readable key', async () => {
    const stores = createPostgresRateLimitStores(prisma);
    await stores('receipts.upload', 60_000).increment('upload:user-1');
    await stores('imports.upload', 60_000).increment('upload:user-1');

    const rows = await prisma.rateLimitCounter.findMany({ orderBy: { key: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.hits)).toEqual([1, 1]);
    expect(rows.map((row) => row.key).sort()).toEqual(
      [
        rateLimitKeyHash('receipts.upload', 'upload:user-1'),
        rateLimitKeyHash('imports.upload', 'upload:user-1'),
      ].sort(),
    );
    for (const row of rows) {
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is cleaned up by maintenance a day after the window ended', async () => {
    const store = createPostgresRateLimitStores(prisma)('test.cleanup', 60_000);
    await store.increment('old');
    await store.increment('recent');
    const now = new Date();
    await prisma.rateLimitCounter.update({
      where: { key: rateLimitKeyHash('test.cleanup', 'old') },
      data: { resetAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
    });

    const report = await runMaintenance(
      prisma,
      { jobs: createPrismaJobStore(prisma), deliveries: createPrismaDeliveryStore(prisma) },
      now,
    );

    expect(report.rateLimitCounters).toBe(1);
    expect(await prisma.rateLimitCounter.count()).toBe(1);
  });
});

describe('shared limits across API instances', () => {
  it('counts failed sign-ins for one address across two app instances', async () => {
    const rateLimits = { loginPerEmail: { limit: 3, windowMs: 60_000 } };
    const first = createContext({ rateLimits, sharedRateLimits: true });
    const second = createContext({ rateLimits, sharedRateLimits: true });
    const credentials = await createVerifiedUser(first);
    const wrong = { email: credentials.email, password: 'wrong passphrase here' };

    await fromApp(request(first.app).post(`${AUTH}/login`))
      .send(wrong)
      .expect(401);
    await fromApp(request(second.app).post(`${AUTH}/login`))
      .send(wrong)
      .expect(401);
    await fromApp(request(first.app).post(`${AUTH}/login`))
      .send(wrong)
      .expect(401);

    // A fresh instance (a restart or another serverless instance) still sees the count.
    const third = createContext({ rateLimits, sharedRateLimits: true });
    const limited = await fromApp(request(third.app).post(`${AUTH}/login`))
      .send({ email: credentials.email, password: credentials.password })
      .expect(429);

    expect(apiErrorResponseSchema.parse(limited.body).error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(limited.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(limited.get('RateLimit-Policy')).toBeDefined();
  });

  it('does not count successful sign-ins in the shared store', async () => {
    const context = createContext({
      rateLimits: { loginPerEmail: { limit: 2, windowMs: 60_000 } },
      sharedRateLimits: true,
    });
    const credentials = await createVerifiedUser(context);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await signIn(context, credentials);
    }
  });
});
