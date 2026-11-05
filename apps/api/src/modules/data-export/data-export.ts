import type { PrismaClient } from '../../generated/prisma/client';

// A person's own records as one JSON document, streamed section by section (never assembled in
// memory or stored as a file). Money stays exact: BIGINT minor units become decimal strings, as
// everywhere else in the API. Left out on purpose: password hashes, sessions, e-mail tokens,
// idempotency keys, private storage keys, and the worker's internal job and e-mail delivery rows.
// Receipt files themselves are not included (their metadata is); they download individually.

export const DATA_EXPORT_FORMAT_VERSION = 1;
const PAGE = 1000;

export interface DataExportSink {
  /** Writes a chunk; resolves once it may write again (back-pressure). */
  write: (chunk: string) => Promise<void>;
  /** True once the client went away; the export stops early. */
  closed: () => boolean;
}

type Row = Record<string, unknown> & { id: string };
type Page = (after: string | undefined) => Promise<Row[]>;

/** BIGINT money as exact decimal strings; everything else as JSON would write it. */
function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

/** Keyset pagination by primary key, so no page is skipped or repeated. */
function pageBy<T extends Row>(
  find: (args: {
    where: { userId: string; id?: { gt: string } };
    orderBy: { id: 'asc' };
    take: number;
  }) => Promise<T[]>,
  userId: string,
): Page {
  return (after) =>
    find({
      where: { userId, ...(after === undefined ? {} : { id: { gt: after } }) },
      orderBy: { id: 'asc' },
      take: PAGE,
    });
}

export async function writeDataExport(
  prisma: PrismaClient,
  userId: string,
  sink: DataExportSink,
  now: Date,
): Promise<void> {
  const profile = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      preferredCurrency: true,
      timezone: true,
      createdAt: true,
    },
  });
  const [notificationPreferences, aiPreference] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.aiPreference.findUnique({ where: { userId } }),
  ]);

  const sections: [string, Page][] = [
    ['accounts', pageBy((args) => prisma.account.findMany(args), userId)],
    ['categories', pageBy((args) => prisma.category.findMany(args), userId)],
    [
      'transactions',
      pageBy(
        (args) => prisma.transaction.findMany({ ...args, omit: { idempotencyKey: true } }),
        userId,
      ),
    ],
    ['budgets', pageBy((args) => prisma.budget.findMany(args), userId)],
    ['recurringSchedules', pageBy((args) => prisma.recurringSchedule.findMany(args), userId)],
    ['scheduledOccurrences', pageBy((args) => prisma.scheduledOccurrence.findMany(args), userId)],
    ['savingsGoals', pageBy((args) => prisma.savingsGoal.findMany(args), userId)],
    ['goalContributions', pageBy((args) => prisma.goalContribution.findMany(args), userId)],
    ['statementImports', pageBy((args) => prisma.statementImport.findMany(args), userId)],
    ['statementImportRows', pageBy((args) => prisma.statementImportRow.findMany(args), userId)],
    [
      'receipts',
      pageBy(
        (args) => prisma.transactionReceipt.findMany({ ...args, omit: { storageKey: true } }),
        userId,
      ),
    ],
    [
      'notifications',
      pageBy(
        (args) => prisma.notification.findMany({ ...args, omit: { dedupeKey: true } }),
        userId,
      ),
    ],
    ['aiConversations', pageBy((args) => prisma.aiConversation.findMany(args), userId)],
    ['aiMessages', pageBy((args) => prisma.aiMessage.findMany(args), userId)],
    ['aiMerchantRules', pageBy((args) => prisma.aiMerchantRule.findMany(args), userId)],
    ['aiDismissals', pageBy((args) => prisma.aiDismissal.findMany(args), userId)],
    ['financialScenarios', pageBy((args) => prisma.financialScenario.findMany(args), userId)],
  ];

  await sink.write(
    `{"format":"calmcash-export","formatVersion":${String(DATA_EXPORT_FORMAT_VERSION)},` +
      `"exportedAt":${encode(now)},"moneyFormat":"minor units as decimal strings",` +
      `"profile":${encode(profile)},` +
      `"notificationPreferences":${encode(notificationPreferences)},` +
      `"aiPreference":${encode(aiPreference)}`,
  );
  for (const [name, page] of sections) {
    await sink.write(`,${encode(name)}:[`);
    let after: string | undefined;
    let first = true;
    for (;;) {
      if (sink.closed()) return;
      const rows = await page(after);
      for (const row of rows) {
        await sink.write(`${first ? '' : ','}${encode(row)}`);
        first = false;
      }
      if (rows.length < PAGE) break;
      after = rows.at(-1)?.id;
    }
    await sink.write(']');
  }
  await sink.write('}');
}
