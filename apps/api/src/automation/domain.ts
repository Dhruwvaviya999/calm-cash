import { currencyCodeSchema } from '@calmcash/shared';

import type { PrismaClient } from '../generated/prisma/client';
import type { Caller } from '../lib/auth-boundary';
import { createAccountsService } from '../modules/accounts/accounts.service';
import { createPrismaAccountsRepository } from '../modules/accounts/accounts.repository';
import { createPrismaBudgetsRepository } from '../modules/budgets/budgets.repository';
import { createBudgetsService, type BudgetsService } from '../modules/budgets/budgets.service';
import { createPrismaDashboardRepository } from '../modules/dashboard/dashboard.repository';
import {
  createDashboardService,
  type DashboardService,
} from '../modules/dashboard/dashboard.service';
import {
  resolvePreferences,
  type ResolvedPreferences,
} from '../modules/notifications/notification-preferences';
import { createPrismaRecurringRepository } from '../modules/recurring/recurring.repository';
import {
  createRecurringService,
  type RecurringService,
} from '../modules/recurring/recurring.service';
import type { TransactionsService } from '../modules/transactions/transactions.service';

// The worker's view of the domain: the same budgets, recurring, and dashboard services the API
// serves, built on the same repositories — so an alert, a reminder, or a summary always agrees
// with what the person sees in the app. No financial rule is re-implemented here. Like the API's
// composition root, it imports services and repositories directly: module index files also
// export Express routers, which must stay out of the worker's bundle (enforced by ESLint).

export interface AutomationDomain {
  budgets: BudgetsService;
  recurring: RecurringService;
  dashboard: DashboardService;
}

/**
 * Reminders describe expected money; they never record it. The recurring service needs a ledger
 * only to confirm a payment, which the worker never does, so its ledger refuses every write.
 */
export const LEDGER_REFUSES_WRITES: Pick<TransactionsService, 'recordLinked'> = {
  recordLinked: () =>
    Promise.reject(new Error('The automation worker never records transactions.')),
};

export function createAutomationDomain(prisma: PrismaClient, now: () => Date): AutomationDomain {
  const accounts = createAccountsService({
    repository: createPrismaAccountsRepository(prisma),
    now,
  });
  return {
    budgets: createBudgetsService({ repository: createPrismaBudgetsRepository(prisma), now }),
    recurring: createRecurringService({
      repository: createPrismaRecurringRepository(prisma),
      transactions: LEDGER_REFUSES_WRITES,
      now,
    }),
    dashboard: createDashboardService({
      repository: createPrismaDashboardRepository(prisma),
      accountSummary: accounts.summary,
      now,
    }),
  };
}

/** Everything a job needs to know about the person it works for. */
export interface UserContext {
  caller: Caller;
  name: string;
  email: string;
  emailVerified: boolean;
  preferences: ResolvedPreferences;
}

/** The user as the services expect them, or `undefined` once the account no longer exists. */
export async function loadUserContext(
  prisma: PrismaClient,
  userId: string,
): Promise<UserContext | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { notificationSettings: true },
  });
  if (user === null) {
    return undefined;
  }
  const currency = currencyCodeSchema.safeParse(user.preferredCurrency);
  return {
    caller: {
      userId: user.id,
      timeZone: user.timezone,
      preferredCurrency: currency.success ? currency.data : 'INR',
    },
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    preferences: resolvePreferences(user.notificationSettings),
  };
}
