import { pino } from 'pino';

import type { Prisma } from '../generated/prisma/client';
import { createPrismaClient } from '../lib/database';
import { createArgon2PasswordHasher } from '../modules/auth/password-hasher';
import { DEFAULT_CATEGORIES } from '../modules/categories/default-categories';

// Synthetic data for performance measurements and restore drills — never real people or money.
// Writes only to a database whose name ends in "_perf" (and never to DATABASE_URL's database):
//
//   SYNTHETIC_DATABASE_URL=postgresql://…/calmcash_perf pnpm --filter @calmcash/api seed:synthetic
//
// Optional: SYNTHETIC_USERS (default 20), SYNTHETIC_TRANSACTIONS (per user, default 2 000; the
// first user gets ten times as many), SYNTHETIC_PASSWORD (shared sign-in password for load tests).
// Every user is perf-user-<n>@example.test. Apply migrations to the database first.

const url = process.env.SYNTHETIC_DATABASE_URL ?? '';
const databaseName = url === '' ? '' : new URL(url).pathname.slice(1);
if (!databaseName.endsWith('_perf') || url === process.env.DATABASE_URL) {
  process.stderr.write('SYNTHETIC_DATABASE_URL must name a separate database ending in "_perf".\n');
  process.exit(2);
}
const USERS = Number(process.env.SYNTHETIC_USERS ?? 20);
const PER_USER = Number(process.env.SYNTHETIC_TRANSACTIONS ?? 2000);
const PASSWORD = process.env.SYNTHETIC_PASSWORD ?? 'synthetic load-test passphrase';
const MONTHS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic pseudo-random numbers (mulberry32), so runs are comparable. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MERCHANTS = ['FreshMart', 'Metro Cafe', 'CityRide', 'PowerGrid', 'BookNook', 'StreamPlus'];

const prisma = createPrismaClient(url, pino({ level: 'warn' }));
const passwordHash = await createArgon2PasswordHasher().hash(PASSWORD);
const now = new Date();
const start = new Date(now.getTime() - MONTHS * 30 * DAY_MS);
const opened = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

try {
  for (let index = 1; index <= USERS; index += 1) {
    const next = random(index * 7919);
    const pick = <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('Nothing to pick from.');
      return item;
    };
    const user = await prisma.user.create({
      data: {
        name: `Perf User ${String(index)}`,
        email: `perf-user-${String(index)}@example.test`,
        passwordHash,
        emailVerifiedAt: now,
        preferredCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      },
    });

    const categories: { id: string; kind: string; name: string }[] = [];
    for (const top of DEFAULT_CATEGORIES) {
      const parent = await prisma.category.create({
        data: { userId: user.id, name: top.name, kind: top.kind },
      });
      categories.push(parent);
      for (const child of top.children ?? []) {
        categories.push(
          await prisma.category.create({
            data: { userId: user.id, name: child, kind: top.kind, parentId: parent.id },
          }),
        );
      }
    }
    const expenseCategories = categories.filter((category) => category.kind === 'expense');
    const salary = categories.find((category) => category.name === 'Salary');
    if (salary === undefined) throw new Error('Salary category missing.');

    const account = (
      name: string,
      type: 'bank' | 'credit_card' | 'cash',
      openingBalanceMinor: bigint,
    ): Promise<{ id: string }> =>
      prisma.account.create({
        data: {
          userId: user.id,
          name,
          type,
          currency: 'INR',
          openingBalanceMinor,
          openingBalanceDate: opened,
          ...(type === 'credit_card' ? { creditLimitMinor: 50_000_000n } : {}),
        },
      });
    const bank = await account('Salary account', 'bank', 25_000_000n);
    const card = await account('Credit card', 'credit_card', 0n);
    const cash = await account('Wallet', 'cash', 500_000n);

    const count = index === 1 ? PER_USER * 10 : PER_USER;
    const rows: Prisma.TransactionCreateManyInput[] = [];
    for (let month = 0; month < MONTHS; month += 1) {
      const payday = new Date(opened.getTime() + (month * 30 + 1) * DAY_MS);
      if (payday > now) break;
      rows.push({
        userId: user.id,
        accountId: bank.id,
        type: 'income',
        amountMinor: 12_000_000n,
        currency: 'INR',
        description: 'Monthly salary',
        categoryId: salary.id,
        occurredAt: payday,
      });
      rows.push({
        userId: user.id,
        accountId: bank.id,
        transferAccountId: card.id,
        type: 'transfer',
        amountMinor: 3_000_000n,
        currency: 'INR',
        description: 'Card bill payment',
        occurredAt: new Date(payday.getTime() + 5 * DAY_MS),
      });
    }
    while (rows.length < count) {
      const category = pick(expenseCategories);
      rows.push({
        userId: user.id,
        accountId: pick([bank.id, card.id, card.id, cash.id]),
        type: 'expense',
        amountMinor: BigInt(1_000 + Math.floor(next() * 400_000)),
        currency: 'INR',
        description: `${category.name} purchase`,
        merchant: pick(MERCHANTS),
        categoryId: category.id,
        paymentMethod: pick(['upi', 'credit_card', 'cash'] as const),
        tags: next() < 0.2 ? ['family'] : [],
        occurredAt: new Date(
          start.getTime() + Math.floor(next() * (now.getTime() - start.getTime())),
        ),
      });
    }
    for (let offset = 0; offset < rows.length; offset += 5000) {
      await prisma.transaction.createMany({ data: rows.slice(offset, offset + 5000) });
    }

    const groceries = categories.find((category) => category.name === 'Groceries');
    const food = categories.find((category) => category.name === 'Food');
    const rent = categories.find((category) => category.name === 'Rent');
    if (groceries === undefined || food === undefined || rent === undefined) {
      throw new Error('Default categories missing.');
    }
    for (const [name, categoryId, limitMinor] of [
      ['Groceries', groceries.id, 1_500_000n],
      ['Food', food.id, 1_000_000n],
    ] as const) {
      await prisma.budget.create({
        data: {
          userId: user.id,
          name,
          categoryId,
          limitMinor,
          currency: 'INR',
          period: 'monthly',
          startDate: opened,
          alertThresholdsBp: [8000],
        },
      });
    }
    await prisma.recurringSchedule.create({
      data: {
        userId: user.id,
        name: 'Rent',
        type: 'expense',
        amountMinor: 2_500_000n,
        currency: 'INR',
        accountId: bank.id,
        categoryId: rent.id,
        frequency: 'monthly',
        startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)),
        nextOccurrenceDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)),
      },
    });
    process.stdout.write(`user ${String(index)}: ${String(rows.length)} transactions\n`);
  }
} finally {
  await prisma.$disconnect();
}
