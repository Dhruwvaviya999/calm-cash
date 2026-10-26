import {
  CSRF_TOKEN_HEADER,
  type AcceptedDto,
  type ApiSuccessResponse,
  type AuthSessionDto,
  type ChangePasswordInput,
  type EmailVerifiedDto,
  type ForgotPasswordInput,
  type LoginInput,
  type PasswordResetDto,
  type RegisterInput,
  type RegistrationDto,
  type ResendVerificationInput,
  type ResetPasswordInput,
  type RevokedSessionsDto,
  type SessionListDto,
  type SignedOutDto,
  type UpdateProfileInput,
  type UserDto,
  type VerifyEmailInput,
} from '@calmcash/shared';
import type { Request, Response } from 'express';

import { AppError } from '../../lib/app-error';
import { sendSuccess } from '../../lib/http-response';
import type { UnvalidatedRequest } from '../../middleware/validate-request';
import { getAuthContext } from './auth.middleware';
import type { AuthService, ClientContext, IssuedSession } from './auth.service';
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
  type SessionCookieConfig,
} from './session-cookie';

interface Body<T> {
  body: T;
}
type Ok<T> = Response<ApiSuccessResponse<T>>;
type Handler<TInput, TData> = (
  input: TInput,
  req: UnvalidatedRequest<ApiSuccessResponse<TData>>,
  res: Ok<TData>,
) => Promise<void>;
type PlainHandler<TData> = (req: Request, res: Ok<TData>) => Promise<void>;

export interface AuthController {
  register: Handler<Body<RegisterInput>, RegistrationDto>;
  verifyEmail: Handler<Body<VerifyEmailInput>, EmailVerifiedDto>;
  resendVerification: Handler<Body<ResendVerificationInput>, AcceptedDto>;
  login: Handler<Body<LoginInput>, AuthSessionDto>;
  logout: PlainHandler<SignedOutDto>;
  getCurrentSession: PlainHandler<AuthSessionDto>;
  updateProfile: Handler<Body<UpdateProfileInput>, UserDto>;
  changePassword: Handler<Body<ChangePasswordInput>, AuthSessionDto>;
  forgotPassword: Handler<Body<ForgotPasswordInput>, AcceptedDto>;
  resetPassword: Handler<Body<ResetPasswordInput>, PasswordResetDto>;
  listSessions: PlainHandler<SessionListDto>;
  revokeSession: Handler<{ params: { sessionId: string } }, RevokedSessionsDto>;
  revokeOtherSessions: PlainHandler<RevokedSessionsDto>;
}

/** Thin HTTP adapter: cookies and status codes here, every decision in the service. */
export function createAuthController(
  service: AuthService,
  cookie: SessionCookieConfig,
  now: () => Date,
): AuthController {
  const clientContext = (req: Pick<Request, 'get'>): ClientContext => ({
    userAgent: req.get('user-agent'),
    presentedSessionToken: readSessionToken(req, cookie),
  });

  const startSession = (res: Response, session: IssuedSession): void => {
    setSessionCookie(res, cookie, session.token, session.expiresAt, now());
  };

  return {
    register: async ({ body }, _req, res) => {
      sendSuccess(res, await service.register(body), 202);
    },

    verifyEmail: async ({ body }, _req, res) => {
      await service.verifyEmail(body.token);
      sendSuccess(res, { emailVerified: true });
    },

    resendVerification: ({ body }, _req, res) => {
      service.resendVerification(body.email);
      sendSuccess(res, { accepted: true }, 202);
      return Promise.resolve();
    },

    login: async ({ body }, req, res) => {
      const session = await service.login(body, clientContext(req));
      startSession(res, session);
      sendSuccess(res, session.body);
    },

    logout: async (req, res) => {
      // Idempotent: without a valid session there is nothing to protect, so the cookie is simply
      // cleared. A live session is only ended with its CSRF token, so other sites cannot sign
      // people out.
      const token = readSessionToken(req, cookie);
      if (token !== undefined) {
        const auth = await service.authenticate(token);
        if (auth !== null && !service.isValidCsrfToken(auth, req.get(CSRF_TOKEN_HEADER))) {
          throw new AppError(
            403,
            'CSRF_TOKEN_INVALID',
            'The security token of this request is missing or out of date. Refresh the page and try again.',
          );
        }
        await service.logout(token);
      }
      clearSessionCookie(res, cookie);
      sendSuccess(res, { signedOut: true });
    },

    getCurrentSession: (req, res) => {
      sendSuccess(res, service.describeSession(getAuthContext(req)));
      return Promise.resolve();
    },

    updateProfile: async ({ body }, req, res) => {
      sendSuccess(res, await service.updateProfile(getAuthContext(req), body));
    },

    changePassword: async ({ body }, req, res) => {
      const session = await service.changePassword(getAuthContext(req), body, clientContext(req));
      startSession(res, session);
      sendSuccess(res, session.body);
    },

    forgotPassword: ({ body }, _req, res) => {
      service.requestPasswordReset(body.email);
      sendSuccess(res, { accepted: true }, 202);
      return Promise.resolve();
    },

    resetPassword: async ({ body }, _req, res) => {
      await service.resetPassword(body);
      // Every session of the account was revoked; drop this browser's cookie too.
      clearSessionCookie(res, cookie);
      sendSuccess(res, { passwordReset: true });
    },

    listSessions: async (req, res) => {
      sendSuccess(res, { sessions: await service.listSessions(getAuthContext(req)) });
    },

    revokeSession: async ({ params }, req, res) => {
      const { revokedCurrent } = await service.revokeSession(getAuthContext(req), params.sessionId);
      if (revokedCurrent) {
        clearSessionCookie(res, cookie);
      }
      sendSuccess(res, { revokedCount: 1 });
    },

    revokeOtherSessions: async (req, res) => {
      sendSuccess(res, { revokedCount: await service.revokeOtherSessions(getAuthContext(req)) });
    },
  };
}
