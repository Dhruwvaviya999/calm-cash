import {
  changePasswordInputSchema,
  entityIdSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resendVerificationInputSchema,
  resetPasswordInputSchema,
  updateProfileInputSchema,
  verifyEmailInputSchema,
} from '@calmcash/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import type { SessionConfig } from '../../config/env';
import type { BackgroundTasks } from '../../lib/background-tasks';
import type { EmailService } from '../../lib/email';
import { validateRequest } from '../../middleware/validate-request';
import { createAuthController } from './auth.controller';
import { createRequireCsrf, createRequireSession, getAuthContext } from './auth.middleware';
import {
  createAuthRateLimiters,
  DEFAULT_AUTH_RATE_LIMITS,
  type AuthRateLimits,
} from './auth.rate-limits';
import type { AuthRepository } from './auth.repository';
import { createAuthService } from './auth.service';
import type { PasswordHasher } from './password-hasher';

export interface AuthModuleDependencies {
  repository: AuthRepository;
  passwordHasher: PasswordHasher;
  emailService: EmailService;
  backgroundTasks: BackgroundTasks;
  /** Injectable clock for deterministic expiry tests. */
  now?: () => Date;
  rateLimits?: Readonly<AuthRateLimits>;
}

export interface AuthModuleConfig {
  session: SessionConfig;
  webAppUrl: string;
}

/** What other modules get from authentication: the router and the signed-in-user boundary. */
export interface AuthModule {
  router: Router;
  /** 401 unless the request carries a valid session; mount before any protected handler. */
  requireSession: RequestHandler;
  /** 403 unless state-changing requests carry the session's CSRF token. */
  requireCsrf: RequestHandler;
  /** The signed-in caller of a request that passed `requireSession`. */
  getCaller: (req: object) => { userId: string; timeZone: string };
}

const body = <TSchema extends z.ZodType>(schema: TSchema): z.ZodObject<{ body: TSchema }> =>
  z.object({ body: schema });

const sessionIdParams = z.object({ params: z.object({ sessionId: entityIdSchema }) });

/**
 * Public:   POST /register, /verify-email, /verify-email/resend, /login, /logout,
 *           /forgot-password, /reset-password
 * Signed in: GET /me, PATCH /profile, POST /password, GET /sessions,
 *           POST /sessions/revoke-others, DELETE /sessions/:sessionId
 * Every state-changing signed-in route also requires the session's CSRF token.
 */
export function createAuthModule(
  dependencies: AuthModuleDependencies,
  config: AuthModuleConfig,
): AuthModule {
  const now = dependencies.now ?? ((): Date => new Date());
  const service = createAuthService({
    repository: dependencies.repository,
    passwordHasher: dependencies.passwordHasher,
    emailService: dependencies.emailService,
    backgroundTasks: dependencies.backgroundTasks,
    links: { webAppUrl: config.webAppUrl },
    session: config.session,
    now,
  });
  const controller = createAuthController(service, config.session, now);
  const limiters = createAuthRateLimiters(dependencies.rateLimits ?? DEFAULT_AUTH_RATE_LIMITS);
  const requireSession = createRequireSession(service, config.session);
  const requireCsrf = createRequireCsrf(service);

  const router = Router();

  // Authentication responses are personal and short-lived: never cache them anywhere.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post(
    '/register',
    ...limiters.register,
    validateRequest(body(registerInputSchema), controller.register),
  );
  router.post(
    '/verify-email',
    ...limiters.verifyEmail,
    validateRequest(body(verifyEmailInputSchema), controller.verifyEmail),
  );
  router.post(
    '/verify-email/resend',
    ...limiters.resendVerification,
    validateRequest(body(resendVerificationInputSchema), controller.resendVerification),
  );
  router.post(
    '/login',
    ...limiters.login,
    validateRequest(body(loginInputSchema), controller.login),
  );
  router.post('/logout', controller.logout);
  router.post(
    '/forgot-password',
    ...limiters.forgotPassword,
    validateRequest(body(forgotPasswordInputSchema), controller.forgotPassword),
  );
  router.post(
    '/reset-password',
    ...limiters.resetPassword,
    validateRequest(body(resetPasswordInputSchema), controller.resetPassword),
  );

  router.get('/me', requireSession, controller.getCurrentSession);
  router.patch(
    '/profile',
    requireSession,
    requireCsrf,
    validateRequest(body(updateProfileInputSchema), controller.updateProfile),
  );
  router.post(
    '/password',
    requireSession,
    requireCsrf,
    ...limiters.changePassword,
    validateRequest(body(changePasswordInputSchema), controller.changePassword),
  );
  router.get('/sessions', requireSession, controller.listSessions);
  router.post(
    '/sessions/revoke-others',
    requireSession,
    requireCsrf,
    controller.revokeOtherSessions,
  );
  router.delete(
    '/sessions/:sessionId',
    requireSession,
    requireCsrf,
    validateRequest(sessionIdParams, controller.revokeSession),
  );

  return {
    router,
    requireSession,
    requireCsrf,
    getCaller: (req) => {
      const { user } = getAuthContext(req);
      return { userId: user.id, timeZone: user.timezone };
    },
  };
}
