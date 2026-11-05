import { pino } from 'pino';

import { parseEnv } from '../config/env';
import { createPrismaClient } from '../lib/database';
import { createLocalFileStorage } from '../lib/file-storage';
import { createVercelBlobFileStorage } from '../lib/vercel-blob-storage';
import {
  auditReceiptStorage,
  DEFAULT_ORPHAN_GRACE_MS,
} from '../modules/receipts/receipt-storage-audit';

// Operator command: compare receipt storage with the database (see receipt-storage-audit.ts).
// Uses the API's own configuration (DATABASE_URL, RECEIPT_STORAGE_*), so run it with the
// environment of the deployment you mean to check. Report only, unless --delete-orphans is given.
//
//   pnpm --filter @calmcash/api receipts:audit
//   pnpm --filter @calmcash/api receipts:audit --delete-orphans [--grace-hours=48]

const args = process.argv.slice(2);
const unknown = args.filter(
  (arg) => arg !== '--delete-orphans' && !arg.startsWith('--grace-hours='),
);
const graceArg = args.find((arg) => arg.startsWith('--grace-hours='));
const graceHours = graceArg === undefined ? undefined : Number(graceArg.split('=')[1]);
if (unknown.length > 0 || (graceHours !== undefined && !(graceHours >= 1))) {
  process.stderr.write('Usage: receipts-audit [--delete-orphans] [--grace-hours=N (N ≥ 1)]\n');
  process.exit(2);
}

const env = parseEnv(process.env);
if (!env.success) {
  process.stderr.write(`Invalid configuration:\n  - ${env.issues.join('\n  - ')}\n`);
  process.exit(1);
}
const { config } = env;
const prisma = createPrismaClient(config.databaseUrl, pino({ level: 'warn' }));
const storage =
  config.receiptStorageProvider === 'vercel-blob' && config.blobReadWriteToken !== undefined
    ? createVercelBlobFileStorage(config.blobReadWriteToken)
    : createLocalFileStorage(config.receiptStorageDir);

try {
  const report = await auditReceiptStorage({
    prisma,
    storage,
    graceMs: graceHours === undefined ? DEFAULT_ORPHAN_GRACE_MS : graceHours * 60 * 60 * 1000,
    deleteOrphans: args.includes('--delete-orphans'),
  });
  process.stdout.write(
    `${JSON.stringify({ provider: config.receiptStorageProvider, ...report }, null, 2)}\n`,
  );
  if (report.missingFiles > 0 || report.orphanDeleteFailures > 0) process.exitCode = 3;
} finally {
  await prisma.$disconnect();
}
