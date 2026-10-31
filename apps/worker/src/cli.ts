import {
  createLogger,
  createPrismaClient,
  createPrismaDeliveryStore,
  createPrismaJobStore,
  parseWorkerEnv,
} from '@calmcash/api/automation';
import { z } from 'zod';

// Operator commands for the worker's queues (no user data is printed — only counts, statuses,
// worker names, and job identifiers):
//
//   pnpm --filter @calmcash/worker status                  queue counts and recent workers
//   pnpm --filter @calmcash/worker requeue-failed [id…]    retry failed jobs (all, or those IDs)
//
// Failed e-mail deliveries are not re-queued from here on purpose: their reminders are usually out
// of date by the time someone looks, and a fresh review creates whatever is still relevant.

const env = parseWorkerEnv(process.env);
if (!env.success) {
  process.stderr.write(`Invalid worker configuration:\n  - ${env.issues.join('\n  - ')}\n`);
  process.exit(1);
}

const logger = createLogger({ ...env.config, logLevel: 'warn' }, 'calmcash-worker-cli');
const prisma = createPrismaClient(env.config.databaseUrl, logger);
const [command, ...rest] = process.argv.slice(2);

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  switch (command ?? '') {
    case 'status': {
      const [jobs, deliveries, workers] = await Promise.all([
        createPrismaJobStore(prisma).countByStatus(),
        createPrismaDeliveryStore(prisma).countByStatus(),
        prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 10 }),
      ]);
      print({
        jobs,
        deliveries,
        workers: workers.map((worker) => ({
          id: worker.id,
          startedAt: worker.startedAt.toISOString(),
          lastSeenAt: worker.lastSeenAt.toISOString(),
        })),
      });
      break;
    }
    case 'requeue-failed': {
      const ids = z.array(z.uuid()).parse(rest);
      const count = await createPrismaJobStore(prisma).requeueFailed(
        new Date(),
        ids.length === 0 ? undefined : ids,
      );
      print({ requeued: count });
      break;
    }
    default:
      process.stderr.write('Usage: cli.ts status | requeue-failed [job-id …]\n');
      process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
