import { describe, expect, it } from 'vitest';

import { newUser } from '../testing/finance-helpers';
import { useIntegrationDatabase } from '../testing/integration-harness';
import { createPrismaDeliveryStore } from './delivery-store';
import { createPrismaJobStore } from './job-store';
import { runMaintenance } from './maintenance';

const { prisma, createContext } = useIntegrationDatabase();
const DAY_MS = 24 * 60 * 60 * 1000;

function maintain(now: Date): ReturnType<typeof runMaintenance> {
  return runMaintenance(
    prisma,
    { jobs: createPrismaJobStore(prisma), deliveries: createPrismaDeliveryStore(prisma) },
    now,
  );
}

describe('maintenance: sessions', () => {
  it('removes long-ended sessions and never a usable one', async () => {
    const context = createContext();
    const user = await newUser(context);
    const now = new Date();
    const userId = user.session.user.id;
    const base = {
      userId,
      csrfTokenHash: 'c'.repeat(64),
      createdAt: new Date(now.getTime() - 200 * DAY_MS),
    };
    await prisma.session.createMany({
      data: [
        // Expired 30 days ago: past the 7-day retention.
        {
          ...base,
          tokenHash: 'a'.repeat(64),
          lastActiveAt: base.createdAt,
          expiresAt: new Date(now.getTime() - 30 * DAY_MS),
        },
        // Revoked yesterday: kept for diagnosis during the retention period.
        {
          ...base,
          tokenHash: 'b'.repeat(64),
          lastActiveAt: new Date(now.getTime() - 2 * DAY_MS),
          expiresAt: new Date(now.getTime() + DAY_MS),
          revokedAt: new Date(now.getTime() - DAY_MS),
        },
      ],
    });
    const before = await prisma.session.count({ where: { userId } });

    const report = await maintain(now);

    expect(report.sessions).toBe(1);
    expect(await prisma.session.count({ where: { userId } })).toBe(before - 1);
    // The signed-in session from newUser() still works.
    await user.agent.get('/api/v1/auth/me').expect(200);
  });
});
