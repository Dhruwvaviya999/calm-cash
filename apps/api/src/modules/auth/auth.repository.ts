import type { CurrencyCode } from '@calmcash/shared';

import {
  Prisma,
  type AuthTokenPurpose,
  type PrismaClient,
  type Session,
  type User,
} from '../../generated/prisma/client';

// Database access for authentication. Every timestamp comparison uses the `now` passed in by the
// service (never the database clock), so expiry behaves identically in code and in tests.

export type UserRecord = User;
export type SessionRecord = Session;

export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  csrfTokenHash: string;
  deviceLabel: string | undefined;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewAuthToken {
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  preferredCurrency: CurrencyCode;
  timezone: string;
  createdAt: Date;
}

export interface ProfileChanges {
  name?: string;
  preferredCurrency?: CurrencyCode;
  timezone?: string;
}

export interface StaleRecordCutoffs {
  /** Sessions that expired or were revoked before this instant are deleted. */
  endedBefore: Date;
  /** Sessions last used before this instant (idle-expired) are deleted. */
  idleBefore: Date;
  /** Tokens that expired or were consumed before this instant are deleted. */
  tokensEndedBefore: Date;
}

/** Thrown by `createUnverifiedUser` when the (normalised) e-mail address is already registered. */
export class EmailAlreadyRegisteredError extends Error {
  override readonly name = 'EmailAlreadyRegisteredError';
}

export interface AuthRepository {
  findUserByEmail: (email: string) => Promise<UserRecord | null>;
  /** Creates the user and their first verification token in one transaction. */
  createUnverifiedUser: (user: NewUser, verificationToken: NewAuthToken) => Promise<UserRecord>;
  /**
   * Replaces the name and password of a still-unverified user and swaps their verification token,
   * in one transaction. Null when the user has been verified in the meantime.
   */
  restartRegistration: (
    userId: string,
    pending: { name: string; passwordHash: string },
    verificationToken: NewAuthToken,
  ) => Promise<UserRecord | null>;
  /** Stores a new token and invalidates every unused token of the same purpose for the user. */
  issueAuthToken: (userId: string, purpose: AuthTokenPurpose, token: NewAuthToken) => Promise<void>;
  /** Atomically consumes a verification token and marks its user verified. */
  verifyEmail: (tokenHash: string, now: Date) => Promise<boolean>;
  /**
   * Atomically consumes a reset token, replaces the password, marks the address verified (the
   * link proved ownership), and revokes every session of the user. Null when the token is unusable.
   */
  resetPassword: (tokenHash: string, passwordHash: string, now: Date) => Promise<UserRecord | null>;
  updatePasswordHash: (userId: string, passwordHash: string) => Promise<void>;
  /** Replaces the password, revokes all of the user's sessions, and opens `replacement`. */
  changePassword: (
    userId: string,
    passwordHash: string,
    replacement: NewSession,
    now: Date,
  ) => Promise<SessionRecord>;
  updateProfile: (userId: string, changes: ProfileChanges) => Promise<UserRecord>;

  /** Opens a session; revokes the session identified by `replacesTokenHash` (rotation on login). */
  createSession: (
    session: NewSession,
    replacesTokenHash: string | undefined,
  ) => Promise<SessionRecord>;
  findSessionByTokenHash: (tokenHash: string) => Promise<SessionWithUser | null>;
  touchSession: (sessionId: string, now: Date) => Promise<void>;
  revokeSessionByTokenHash: (tokenHash: string, now: Date) => Promise<void>;
  listActiveSessions: (userId: string, now: Date, idleBefore: Date) => Promise<SessionRecord[]>;
  /** Revokes the session only if it belongs to `userId`; false when there was nothing to revoke. */
  revokeUserSession: (userId: string, sessionId: string, now: Date) => Promise<boolean>;
  revokeOtherSessions: (userId: string, keepSessionId: string, now: Date) => Promise<number>;
  deleteStaleRecords: (
    cutoffs: StaleRecordCutoffs,
  ) => Promise<{ sessions: number; tokens: number }>;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function sessionData(session: NewSession): Prisma.SessionUncheckedCreateInput {
  return {
    userId: session.userId,
    tokenHash: session.tokenHash,
    csrfTokenHash: session.csrfTokenHash,
    deviceLabel: session.deviceLabel ?? null,
    createdAt: session.createdAt,
    lastActiveAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

/** Marks the matching unused, unexpired token consumed. Exactly one concurrent caller can win. */
async function consumeToken(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  purpose: AuthTokenPurpose,
  now: Date,
): Promise<string | null> {
  // PostgreSQL row locking makes a concurrent second UPDATE wait, then re-check the WHERE clause
  // against the committed row, so it matches nothing once the first consumer has committed.
  const { count } = await tx.authToken.updateMany({
    where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (count !== 1) {
    return null;
  }
  const token = await tx.authToken.findUniqueOrThrow({
    where: { tokenHash },
    select: { userId: true },
  });
  return token.userId;
}

export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    findUserByEmail: (email) => prisma.user.findUnique({ where: { email } }),

    createUnverifiedUser: async (user, verificationToken) => {
      try {
        return await prisma.user.create({
          data: {
            name: user.name,
            email: user.email,
            passwordHash: user.passwordHash,
            preferredCurrency: user.preferredCurrency,
            timezone: user.timezone,
            createdAt: user.createdAt,
            authTokens: {
              create: {
                purpose: 'email_verification',
                tokenHash: verificationToken.tokenHash,
                createdAt: verificationToken.createdAt,
                expiresAt: verificationToken.expiresAt,
              },
            },
          },
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new EmailAlreadyRegisteredError('The e-mail address is already registered.', {
            cause: error,
          });
        }
        throw error;
      }
    },

    restartRegistration: (userId, pending, verificationToken) =>
      prisma.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { name: pending.name, passwordHash: pending.passwordHash },
        });
        if (count !== 1) {
          return null;
        }
        await tx.authToken.deleteMany({
          where: { userId, purpose: 'email_verification', consumedAt: null },
        });
        await tx.authToken.create({
          data: {
            userId,
            purpose: 'email_verification',
            tokenHash: verificationToken.tokenHash,
            createdAt: verificationToken.createdAt,
            expiresAt: verificationToken.expiresAt,
          },
        });
        return tx.user.findUniqueOrThrow({ where: { id: userId } });
      }),

    issueAuthToken: async (userId, purpose, token) => {
      await prisma.$transaction([
        prisma.authToken.deleteMany({ where: { userId, purpose, consumedAt: null } }),
        prisma.authToken.create({
          data: {
            userId,
            purpose,
            tokenHash: token.tokenHash,
            createdAt: token.createdAt,
            expiresAt: token.expiresAt,
          },
        }),
      ]);
    },

    verifyEmail: (tokenHash, now) =>
      prisma.$transaction(async (tx) => {
        const userId = await consumeToken(tx, tokenHash, 'email_verification', now);
        if (userId === null) {
          return false;
        }
        await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: now },
        });
        return true;
      }),

    resetPassword: (tokenHash, passwordHash, now) =>
      prisma.$transaction(async (tx) => {
        const userId = await consumeToken(tx, tokenHash, 'password_reset', now);
        if (userId === null) {
          return null;
        }
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const user = await tx.user.update({
          where: { id: userId },
          data: { passwordHash, emailVerifiedAt: current.emailVerifiedAt ?? now },
        });
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.authToken.deleteMany({
          where: { userId, purpose: 'password_reset', consumedAt: null },
        });
        return user;
      }),

    updatePasswordHash: async (userId, passwordHash) => {
      await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    },

    changePassword: (userId, passwordHash, replacement, now) =>
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.authToken.deleteMany({
          where: { userId, purpose: 'password_reset', consumedAt: null },
        });
        return tx.session.create({ data: sessionData(replacement) });
      }),

    updateProfile: (userId, changes) =>
      prisma.user.update({
        where: { id: userId },
        data: {
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.preferredCurrency === undefined
            ? {}
            : { preferredCurrency: changes.preferredCurrency }),
          ...(changes.timezone === undefined ? {} : { timezone: changes.timezone }),
        },
      }),

    createSession: async (session, replacesTokenHash) => {
      if (replacesTokenHash === undefined) {
        return prisma.session.create({ data: sessionData(session) });
      }
      const [, created] = await prisma.$transaction([
        prisma.session.updateMany({
          where: { tokenHash: replacesTokenHash, revokedAt: null },
          data: { revokedAt: session.createdAt },
        }),
        prisma.session.create({ data: sessionData(session) }),
      ]);
      return created;
    },

    findSessionByTokenHash: async (tokenHash) => {
      const found = await prisma.session.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (found === null) {
        return null;
      }
      const { user, ...session } = found;
      return { session, user };
    },

    touchSession: async (sessionId, now) => {
      await prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { lastActiveAt: now },
      });
    },

    revokeSessionByTokenHash: async (tokenHash, now) => {
      await prisma.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
    },

    listActiveSessions: (userId, now, idleBefore) =>
      prisma.session.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          lastActiveAt: { gt: idleBefore },
        },
        orderBy: { lastActiveAt: 'desc' },
      }),

    revokeUserSession: async (userId, sessionId, now) => {
      const { count } = await prisma.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return count === 1;
    },

    revokeOtherSessions: async (userId, keepSessionId, now) => {
      const { count } = await prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: keepSessionId } },
        data: { revokedAt: now },
      });
      return count;
    },

    deleteStaleRecords: async ({ endedBefore, idleBefore, tokensEndedBefore }) => {
      const [sessions, tokens] = await prisma.$transaction([
        prisma.session.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: endedBefore } },
              { revokedAt: { lt: endedBefore } },
              { lastActiveAt: { lt: idleBefore } },
            ],
          },
        }),
        prisma.authToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: tokensEndedBefore } },
              { consumedAt: { lt: tokensEndedBefore } },
            ],
          },
        }),
      ]);
      return { sessions: sessions.count, tokens: tokens.count };
    },
  };
}
