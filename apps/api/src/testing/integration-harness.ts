import {
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  authSessionDtoSchema,
  CSRF_TOKEN_HEADER,
  type AuthSessionDto,
} from '@calmcash/shared';
import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeEach, expect } from 'vitest';

import { createApp } from '../app';
import { createBackgroundTasks, type BackgroundTasks } from '../lib/background-tasks';
import { createPrismaClient, type PrismaClient } from '../lib/database';
import { createPostgresRateLimitStores } from '../lib/rate-limit';
import {
  createPrismaAccountsRepository,
  type AccountsRepository,
} from '../modules/accounts/accounts.repository';
import type { AuthRateLimits, RateLimitRule } from '../modules/auth/auth.rate-limits';
import { createPrismaAuthRepository, type AuthRepository } from '../modules/auth/auth.repository';
import { createPrismaBudgetsRepository } from '../modules/budgets/budgets.repository';
import { createPrismaCategoriesRepository } from '../modules/categories/categories.repository';
import { createPrismaDashboardRepository } from '../modules/dashboard/dashboard.repository';
import { createPrismaGoalsRepository } from '../modules/goals/goals.repository';
import {
  createPrismaImportsRepository,
  type ImportsRepository,
} from '../modules/imports/imports.repository';
import { createPrismaNotificationsRepository } from '../modules/notifications';
import { createPrismaAiRepository } from '../modules/ai/ai.repository';
import { createPrismaInsightsRepository } from '../modules/insights/insights.repository';
import { createPrismaIntelligenceRepository } from '../modules/intelligence/intelligence.repository';
import { createFakeAiProvider, type FakeAiProvider } from './fake-ai-provider';
import { createPrismaReceiptsRepository } from '../modules/receipts/receipts.repository';
import type { FileStorage } from '../lib/file-storage';
import { createInMemoryFileStorage, type InMemoryFileStorage } from './in-memory-storage';
import { createPrismaRecurringRepository, type RecurringRepository } from '../modules/recurring';
import { createPrismaTagsRepository } from '../modules/tags/tags.repository';
import {
  createPrismaTransactionsRepository,
  type TransactionsRepository,
} from '../modules/transactions/transactions.repository';
import { createArgon2PasswordHasher } from '../modules/auth/password-hasher';
import { assertDisposableDatabaseUrl } from './disposable-database';
import { FAST_ARGON2_PARAMETERS, TEST_ALLOWED_ORIGIN, TEST_APP_CONFIG } from './create-test-app';
import { createInMemoryEmailService, type InMemoryEmailService } from './in-memory-email';

export const AUTH = `${API_V1_PREFIX}/auth`;
export const STRONG_PASSWORD = 'correct horse battery staple';
export const SESSION_COOKIE = TEST_APP_CONFIG.session.cookieName;

/** Effectively unlimited, so only the suites about rate limiting ever hit a limit. */
const UNLIMITED: RateLimitRule = { limit: 10_000, windowMs: 60_000 };
const UNLIMITED_RATE_LIMITS: AuthRateLimits = {
  loginPerIp: UNLIMITED,
  loginPerEmail: UNLIMITED,
  registerPerIp: UNLIMITED,
  verifyEmailPerIp: UNLIMITED,
  resendVerificationPerIp: UNLIMITED,
  resendVerificationPerEmail: UNLIMITED,
  forgotPasswordPerIp: UNLIMITED,
  forgotPasswordPerEmail: UNLIMITED,
  resetPasswordPerIp: UNLIMITED,
  changePasswordPerUser: UNLIMITED,
};

/** A controllable clock: starts at the real time and only moves when a test says so. */
export interface TestClock {
  now: () => Date;
  advance: (milliseconds: number) => void;
}

function createTestClock(): TestClock {
  let current = Date.now();
  return {
    now: () => new Date(current),
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

export interface TestContext {
  app: Express;
  /** Receipt files written by this app. */
  storage: InMemoryFileStorage;
  prisma: PrismaClient;
  repository: AuthRepository;
  email: InMemoryEmailService;
  clock: TestClock;
  tasks: BackgroundTasks;
  /** The scripted local model of this app. */
  ai: FakeAiProvider;
}

export interface TestContextOptions {
  rateLimits?: Partial<AuthRateLimits>;
  /** Wraps the real accounts repository, e.g. to simulate database failures. */
  accountsRepository?: (real: AccountsRepository) => AccountsRepository;
  /** Wraps the real transactions repository, e.g. to inject a failure in the middle of a write. */
  transactionsRepository?: (real: TransactionsRepository) => TransactionsRepository;
  /** Wraps the real recurring repository, e.g. to inject a failure while recording a payment. */
  recurringRepository?: (real: RecurringRepository) => RecurringRepository;
  /** Wraps the real imports repository, e.g. to inject a failure while importing a row. */
  importsRepository?: (real: ImportsRepository) => ImportsRepository;
  /** Wraps the in-memory receipt storage, e.g. to make removals fail. */
  receiptStorage?: (real: InMemoryFileStorage) => FileStorage;
  /** AI settings of this app (defaults: enabled, effectively unlimited). */
  ai?: { enabled?: boolean; rateLimit?: { limit: number; windowMs: number } };
  /** Count rate limits in PostgreSQL, as deployed (default: a memory store per app). */
  sharedRateLimits?: boolean;
  /** Data-export limit (default: five an hour, as deployed). */
  dataExportRateLimit?: { limit: number; windowMs: number };
}

/**
 * Registers per-file setup against the dedicated test database: one Prisma client per file, every
 * table truncated before each test, and a fresh app (clock, outbox, rate-limit counters) per call.
 */
export function useIntegrationDatabase(): {
  prisma: PrismaClient;
  createContext: (options?: TestContextOptions) => TestContext;
} {
  const url = assertDisposableDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  const logger = pino({ level: 'silent' });
  const prisma = createPrismaClient(url, logger);

  beforeEach(async () => {
    // Users cascade to sessions, tokens, notifications, and all financial tables; jobs without an
    // owner (maintenance), worker heartbeats, and rate-limit counters are cleared explicitly.
    await prisma.$executeRaw`TRUNCATE TABLE "users", "automation_jobs", "worker_heartbeats", "rate_limit_counters" CASCADE`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  return {
    prisma,
    createContext: (options = {}) => {
      const clock = createTestClock();
      const email = createInMemoryEmailService();
      const tasks = createBackgroundTasks(logger);
      const repository = createPrismaAuthRepository(prisma);
      const storage = createInMemoryFileStorage();
      const ai = createFakeAiProvider();
      const rateLimitStore =
        options.sharedRateLimits === true ? createPostgresRateLimitStores(prisma) : undefined;
      const shared = rateLimitStore === undefined ? {} : { rateLimitStore };
      const app = createApp({
        config: { ...TEST_APP_CONFIG, jsonBodyLimit: '10kb' },
        logger,
        checkDatabase: () => Promise.resolve(true),
        auth: {
          repository,
          passwordHasher: createArgon2PasswordHasher(FAST_ARGON2_PARAMETERS),
          emailService: email,
          backgroundTasks: tasks,
          now: clock.now,
          rateLimits: { ...UNLIMITED_RATE_LIMITS, ...options.rateLimits },
          ...shared,
        },
        accounts: {
          repository: (options.accountsRepository ?? ((real) => real))(
            createPrismaAccountsRepository(prisma),
          ),
          now: clock.now,
        },
        transactions: {
          repository: (options.transactionsRepository ?? ((real) => real))(
            createPrismaTransactionsRepository(prisma, { now: clock.now }),
          ),
          now: clock.now,
        },
        categories: { repository: createPrismaCategoriesRepository(prisma), now: clock.now },
        tags: { repository: createPrismaTagsRepository(prisma) },
        dashboard: { repository: createPrismaDashboardRepository(prisma), now: clock.now },
        budgets: {
          repository: createPrismaBudgetsRepository(prisma, { now: clock.now }),
          now: clock.now,
        },
        recurring: {
          repository: (options.recurringRepository ?? ((real) => real))(
            createPrismaRecurringRepository(prisma),
          ),
          now: clock.now,
        },
        goals: { repository: createPrismaGoalsRepository(prisma), now: clock.now },
        imports: {
          repository: (options.importsRepository ?? ((real) => real))(
            createPrismaImportsRepository(prisma),
          ),
          now: clock.now,
          uploadRate: { limit: 10_000, windowMs: 60_000 },
          ...shared,
        },
        receipts: {
          repository: createPrismaReceiptsRepository(prisma),
          storage: (options.receiptStorage ?? ((real) => real))(storage),
          now: clock.now,
          uploadRate: { limit: 10_000, windowMs: 60_000 },
          ...shared,
        },
        notifications: {
          repository: createPrismaNotificationsRepository(prisma),
          now: clock.now,
        },
        ai: {
          repository: createPrismaAiRepository(prisma),
          provider: ai,
          config: {
            enabled: options.ai?.enabled ?? true,
            rateLimit: options.ai?.rateLimit ?? { limit: 10_000, windowMs: 60_000 },
          },
          now: clock.now,
          ...shared,
        },
        insights: { repository: createPrismaInsightsRepository(prisma) },
        intelligence: {
          repository: createPrismaIntelligenceRepository(prisma),
          now: clock.now,
          rateLimit: { limit: 10_000, windowMs: 60_000 },
          ...shared,
        },
        dataExport: {
          prisma,
          now: clock.now,
          ...(options.dataExportRateLimit === undefined
            ? {}
            : { rateLimit: options.dataExportRateLimit }),
          ...shared,
        },
      });
      return { app, prisma, repository, email, clock, tasks, storage, ai };
    },
  };
}

export interface Credentials {
  name: string;
  email: string;
  password: string;
}

let userCounter = 0;

export function newCredentials(overrides: Partial<Credentials> = {}): Credentials {
  userCounter += 1;
  return {
    name: `Test User ${userCounter}`,
    email: `user${userCounter}.${Date.now()}@example.com`,
    password: STRONG_PASSWORD,
    ...overrides,
  };
}

/** A request from the web app's origin, as a browser would send it. */
export function fromApp(test: request.Test): request.Test {
  return test.set('Origin', TEST_ALLOWED_ORIGIN);
}

export async function register(context: TestContext, credentials: Credentials): Promise<void> {
  await fromApp(request(context.app).post(`${AUTH}/register`))
    .send({ ...credentials, passwordConfirmation: credentials.password })
    .expect(202);
}

export async function verifyLatestLink(context: TestContext, email: string): Promise<void> {
  const token = context.email.latestToken(email, 'email-verification');
  await fromApp(request(context.app).post(`${AUTH}/verify-email`))
    .send({ token })
    .expect(200);
}

/** Registers and verifies a new user; returns their credentials. */
export async function createVerifiedUser(
  context: TestContext,
  overrides: Partial<Credentials> = {},
): Promise<Credentials> {
  const credentials = newCredentials(overrides);
  await register(context, credentials);
  await verifyLatestLink(context, credentials.email);
  return credentials;
}

export interface SignedIn {
  /** Carries the session cookie like a browser. */
  agent: ReturnType<typeof request.agent>;
  session: AuthSessionDto;
  /** Raw `name=value` of the session cookie, for assertions. */
  cookieValue: string;
}

export function sessionCookieValue(response: request.Response): string | undefined {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header.filter((item) => typeof item === 'string') : [];
  const cookie = cookies.find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  return cookie?.split(';')[0]?.slice(SESSION_COOKIE.length + 1);
}

export async function signIn(
  context: TestContext,
  credentials: Pick<Credentials, 'email' | 'password'>,
  userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
): Promise<SignedIn> {
  const agent = request.agent(context.app);
  const response = await fromApp(agent.post(`${AUTH}/login`))
    .set('User-Agent', userAgent)
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);
  const cookieValue = sessionCookieValue(response);
  expect(cookieValue).toBeDefined();
  return {
    agent,
    session: apiSuccessResponseSchema(authSessionDtoSchema).parse(response.body).data,
    cookieValue: cookieValue ?? '',
  };
}

/** Adds the browser origin and the session's CSRF token, as the web client does. */
export function withCsrf(test: request.Test, signedIn: Pick<SignedIn, 'session'>): request.Test {
  return fromApp(test).set(CSRF_TOKEN_HEADER, signedIn.session.csrfToken);
}

export function cookieHeader(value: string): string {
  return `${SESSION_COOKIE}=${value}`;
}
