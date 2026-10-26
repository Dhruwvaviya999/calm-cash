import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  type AuthSessionDto,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type RegistrationDto,
  type ResetPasswordInput,
  type SessionDto,
  type UpdateProfileInput,
  type UserDto,
} from '@calmcash/shared';

import type { SessionConfig } from '../../config/env';
import { AppError } from '../../lib/app-error';
import type { BackgroundTasks } from '../../lib/background-tasks';
import { EmailDeliveryError, type EmailMessage, type EmailService } from '../../lib/email';
import {
  existingAccountEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
  type AuthEmailLinks,
} from './auth.emails';
import { toSessionDto, toUserDto } from './auth.mapper';
import {
  EmailAlreadyRegisteredError,
  type AuthRepository,
  type NewAuthToken,
  type NewSession,
  type SessionRecord,
  type UserRecord,
} from './auth.repository';
import type { PasswordHasher } from './password-hasher';
import { deriveCsrfToken, digestsEqual, generateToken, hashToken } from './tokens';
import { describeUserAgent } from './user-agent';

const MINUTE_MS = 60 * 1000;
const VERIFICATION_TOKEN_TTL_MS = EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * MINUTE_MS;
const RESET_TOKEN_TTL_MS = PASSWORD_RESET_TOKEN_TTL_MINUTES * MINUTE_MS;
/** `lastActiveAt` is written at most this often, so authenticated reads rarely cause writes. */
const SESSION_TOUCH_INTERVAL_MS = 5 * MINUTE_MS;

/** The authenticated request: who is calling and through which session. */
export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
  /** The raw cookie value. Kept in memory for CSRF derivation only; never logged or stored. */
  sessionToken: string;
}

/** A freshly opened session: the cookie value plus the body returned to the client. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  body: AuthSessionDto;
}

export interface ClientContext {
  userAgent: string | undefined;
  /** Session token presented with the request, revoked when a new session replaces it. */
  presentedSessionToken: string | undefined;
}

export interface AuthService {
  register: (input: RegisterInput) => Promise<RegistrationDto>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: (email: string) => void;
  login: (input: LoginInput, client: ClientContext) => Promise<IssuedSession>;
  authenticate: (sessionToken: string) => Promise<AuthContext | null>;
  isValidCsrfToken: (auth: AuthContext, csrfToken: string | undefined) => boolean;
  describeSession: (auth: AuthContext) => AuthSessionDto;
  logout: (sessionToken: string | undefined) => Promise<void>;
  updateProfile: (auth: AuthContext, input: UpdateProfileInput) => Promise<UserDto>;
  changePassword: (
    auth: AuthContext,
    input: ChangePasswordInput,
    client: ClientContext,
  ) => Promise<IssuedSession>;
  requestPasswordReset: (email: string) => void;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
  listSessions: (auth: AuthContext) => Promise<SessionDto[]>;
  /** Resolves with whether the revoked session was the caller's own. */
  revokeSession: (auth: AuthContext, sessionId: string) => Promise<{ revokedCurrent: boolean }>;
  revokeOtherSessions: (auth: AuthContext) => Promise<number>;
}

export interface AuthServiceDependencies {
  repository: AuthRepository;
  passwordHasher: PasswordHasher;
  emailService: EmailService;
  backgroundTasks: BackgroundTasks;
  links: AuthEmailLinks;
  session: Pick<SessionConfig, 'maxAgeMs' | 'idleTimeoutMs'>;
  now: () => Date;
}

const invalidCredentials = (): AppError =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The email address or password is incorrect.');

export function createAuthService({
  repository,
  passwordHasher,
  emailService,
  backgroundTasks,
  links,
  session: sessionConfig,
  now,
}: AuthServiceDependencies): AuthService {
  const newToken = (ttlMs: number): { token: string; record: NewAuthToken } => {
    const token = generateToken();
    const createdAt = now();
    return {
      token,
      record: {
        tokenHash: hashToken(token),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + ttlMs),
      },
    };
  };

  /** Sends now and turns a delivery failure into a 503: success is never claimed without it. */
  const sendNow = async (message: EmailMessage): Promise<void> => {
    try {
      await emailService.send(message);
    } catch (error: unknown) {
      if (error instanceof EmailDeliveryError) {
        throw new AppError(
          503,
          'EMAIL_DELIVERY_FAILED',
          'We could not send the email right now. Please try again in a few minutes.',
          { cause: error },
        );
      }
      throw error;
    }
  };

  const sendInBackground = (name: string, compose: () => Promise<EmailMessage | null>): void => {
    backgroundTasks.run(name, async () => {
      const message = await compose();
      if (message !== null) {
        await emailService.send(message);
      }
    });
  };

  const prepareSession = (
    user: UserRecord,
    client: ClientContext,
  ): { token: string; csrfToken: string; record: NewSession } => {
    const token = generateToken();
    const csrfToken = deriveCsrfToken(token);
    const createdAt = now();
    return {
      token,
      csrfToken,
      record: {
        userId: user.id,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken(csrfToken),
        deviceLabel: describeUserAgent(client.userAgent),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + sessionConfig.maxAgeMs),
      },
    };
  };

  const issued = (
    user: UserRecord,
    session: SessionRecord,
    token: string,
    csrfToken: string,
  ): IssuedSession => ({
    token,
    expiresAt: session.expiresAt,
    body: {
      user: toUserDto(user),
      csrfToken,
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
    },
  });

  /**
   * Someone registered with an address that already has an account. The response must look the
   * same as for a new address, so the outcome is communicated by e-mail only:
   * - verified account: a notice that an account exists (nothing changes);
   * - unverified account: the pending registration is replaced by this one (latest wins, older
   *   links stop working), so a squatter who registered the address first cannot keep a password
   *   the real owner later verifies.
   */
  const handleExistingRegistration = async (
    input: RegisterInput,
    passwordHash: string,
  ): Promise<void> => {
    const existing = await repository.findUserByEmail(input.email);
    if (existing === null) {
      return;
    }
    if (existing.emailVerifiedAt !== null) {
      await sendNow(existingAccountEmail(links, existing));
      return;
    }
    const { token, record } = newToken(VERIFICATION_TOKEN_TTL_MS);
    const restarted = await repository.restartRegistration(
      existing.id,
      { name: input.name, passwordHash },
      record,
    );
    if (restarted !== null) {
      await sendNow(verificationEmail(links, restarted, token));
    }
  };

  return {
    register: async (input) => {
      // Hash first on every path, so new and existing addresses take comparable time.
      const passwordHash = await passwordHasher.hash(input.password);
      const { token, record } = newToken(VERIFICATION_TOKEN_TTL_MS);

      try {
        const user = await repository.createUnverifiedUser(
          {
            name: input.name,
            email: input.email,
            passwordHash,
            preferredCurrency: DEFAULT_CURRENCY,
            timezone: DEFAULT_TIMEZONE,
            createdAt: record.createdAt,
          },
          record,
        );
        await sendNow(verificationEmail(links, user, token));
      } catch (error: unknown) {
        if (!(error instanceof EmailAlreadyRegisteredError)) {
          throw error;
        }
        await handleExistingRegistration(input, passwordHash);
      }

      return { email: input.email, verificationRequired: true };
    },

    verifyEmail: async (token) => {
      const verified = await repository.verifyEmail(hashToken(token), now());
      if (!verified) {
        throw new AppError(
          400,
          'INVALID_TOKEN',
          'This confirmation link is invalid, has expired, or was already used. Request a new one below.',
        );
      }
    },

    resendVerification: (email) => {
      sendInBackground('resend-verification', async () => {
        const user = await repository.findUserByEmail(email);
        // Only pending registrations get a new link; verified and password-less users do not.
        const pending =
          user !== null && user.emailVerifiedAt === null && user.passwordHash !== null;
        if (!pending) {
          return null;
        }
        const { token, record } = newToken(VERIFICATION_TOKEN_TTL_MS);
        await repository.issueAuthToken(user.id, 'email_verification', record);
        return verificationEmail(links, user, token);
      });
    },

    login: async (input, client) => {
      const user = await repository.findUserByEmail(input.email);
      const passwordHash = user?.passwordHash ?? null;
      if (user === null || passwordHash === null) {
        await passwordHasher.verifyAgainstDummy(input.password);
        throw invalidCredentials();
      }
      if (!(await passwordHasher.verify(passwordHash, input.password))) {
        throw invalidCredentials();
      }
      // Only reached with the correct password, so this reveals nothing to a guesser.
      if (user.emailVerifiedAt === null) {
        throw new AppError(
          403,
          'EMAIL_NOT_VERIFIED',
          'Confirm your email address before signing in. Check your inbox, or request a new link.',
        );
      }
      if (passwordHasher.needsRehash(passwordHash)) {
        await repository.updatePasswordHash(user.id, await passwordHasher.hash(input.password));
      }

      // A brand-new session on every login (never one the client chose): no session fixation.
      const prepared = prepareSession(user, client);
      const presented =
        client.presentedSessionToken === undefined
          ? undefined
          : hashToken(client.presentedSessionToken);
      const session = await repository.createSession(prepared.record, presented);
      return issued(user, session, prepared.token, prepared.csrfToken);
    },

    authenticate: async (sessionToken) => {
      const found = await repository.findSessionByTokenHash(hashToken(sessionToken));
      if (found === null) {
        return null;
      }
      const { user } = found;
      let { session } = found;
      const at = now();
      const idleExpired =
        session.lastActiveAt.getTime() + sessionConfig.idleTimeoutMs <= at.getTime();

      if (
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= at.getTime() ||
        idleExpired ||
        user.emailVerifiedAt === null
      ) {
        return null;
      }

      if (at.getTime() - session.lastActiveAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
        await repository.touchSession(session.id, at);
        session = { ...session, lastActiveAt: at };
      }
      return { user, session, sessionToken };
    },

    isValidCsrfToken: (auth, csrfToken) =>
      csrfToken !== undefined && digestsEqual(hashToken(csrfToken), auth.session.csrfTokenHash),

    describeSession: (auth) => ({
      user: toUserDto(auth.user),
      csrfToken: deriveCsrfToken(auth.sessionToken),
      sessionId: auth.session.id,
      expiresAt: auth.session.expiresAt.toISOString(),
    }),

    logout: async (sessionToken) => {
      if (sessionToken !== undefined) {
        await repository.revokeSessionByTokenHash(hashToken(sessionToken), now());
      }
    },

    updateProfile: async (auth, input) =>
      toUserDto(await repository.updateProfile(auth.user.id, input)),

    changePassword: async (auth, input, client) => {
      const { passwordHash } = auth.user;
      if (
        passwordHash === null ||
        !(await passwordHasher.verify(passwordHash, input.currentPassword))
      ) {
        throw new AppError(400, 'INVALID_CREDENTIALS', 'Your current password is incorrect.', {
          details: [
            { path: 'body.currentPassword', message: 'Your current password is incorrect.' },
          ],
        });
      }

      const newHash = await passwordHasher.hash(input.newPassword);
      const prepared = prepareSession(auth.user, client);
      // Every existing session (this one included) is revoked and replaced by a fresh one.
      const session = await repository.changePassword(
        auth.user.id,
        newHash,
        prepared.record,
        now(),
      );
      sendInBackground('password-changed-notice', () =>
        Promise.resolve(passwordChangedEmail(links, auth.user)),
      );
      return issued(auth.user, session, prepared.token, prepared.csrfToken);
    },

    requestPasswordReset: (email) => {
      // Look-up, token, and delivery all happen after the response, so neither its content nor
      // its timing shows whether the address is registered.
      sendInBackground('password-reset', async () => {
        const user = await repository.findUserByEmail(email);
        if (user === null) {
          return null;
        }
        const { token, record } = newToken(RESET_TOKEN_TTL_MS);
        await repository.issueAuthToken(user.id, 'password_reset', record);
        return passwordResetEmail(links, user, token);
      });
    },

    resetPassword: async (input) => {
      const newHash = await passwordHasher.hash(input.password);
      const user = await repository.resetPassword(hashToken(input.token), newHash, now());
      if (user === null) {
        throw new AppError(
          400,
          'INVALID_TOKEN',
          'This reset link is invalid, has expired, or was already used. Request a new one.',
        );
      }
      sendInBackground('password-changed-notice', () =>
        Promise.resolve(passwordChangedEmail(links, user)),
      );
    },

    listSessions: async (auth) => {
      const at = now();
      const idleBefore = new Date(at.getTime() - sessionConfig.idleTimeoutMs);
      const sessions = await repository.listActiveSessions(auth.user.id, at, idleBefore);
      return sessions.map((session) => toSessionDto(session, auth.session.id));
    },

    revokeSession: async (auth, sessionId) => {
      // Scoped by user ID: another user's session ID behaves exactly like an unknown one.
      const revoked = await repository.revokeUserSession(auth.user.id, sessionId, now());
      if (!revoked) {
        throw new AppError(404, 'NOT_FOUND', 'That session does not exist or has already ended.');
      }
      return { revokedCurrent: sessionId === auth.session.id };
    },

    revokeOtherSessions: (auth) =>
      repository.revokeOtherSessions(auth.user.id, auth.session.id, now()),
  };
}
