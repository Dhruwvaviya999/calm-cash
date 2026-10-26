import {
  acceptedDtoSchema,
  authSessionDtoSchema,
  emailVerifiedDtoSchema,
  passwordResetDtoSchema,
  registrationDtoSchema,
  revokedSessionsDtoSchema,
  sessionListDtoSchema,
  signedOutDtoSchema,
  userDtoSchema,
  type AcceptedDto,
  type AuthSessionDto,
  type ChangePasswordInput,
  type EmailVerifiedDto,
  type EntityId,
  type LoginInput,
  type PasswordResetDto,
  type RegisterInput,
  type RegistrationDto,
  type ResetPasswordInput,
  type RevokedSessionsDto,
  type SessionListDto,
  type SignedOutDto,
  type UpdateProfileInput,
  type UserDto,
} from '@calmcash/shared';

import { api } from '@/lib/api';

// One function per authentication endpoint. Every response is validated against the shared
// schema before it is returned, and the session itself is only ever an HttpOnly cookie.

/** Rejects with an `ApiClientError` coded `UNAUTHORIZED` when nobody is signed in. */
export function getCurrentSession(signal?: AbortSignal): Promise<AuthSessionDto> {
  return api.request('/auth/me', { schema: authSessionDtoSchema, signal });
}

export function login(input: LoginInput): Promise<AuthSessionDto> {
  return api.request('/auth/login', { schema: authSessionDtoSchema, method: 'POST', body: input });
}

export function logout(): Promise<SignedOutDto> {
  return api.request('/auth/logout', { schema: signedOutDtoSchema, method: 'POST' });
}

export function register(input: RegisterInput): Promise<RegistrationDto> {
  return api.request('/auth/register', {
    schema: registrationDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function verifyEmail(token: string): Promise<EmailVerifiedDto> {
  return api.request('/auth/verify-email', {
    schema: emailVerifiedDtoSchema,
    method: 'POST',
    body: { token },
  });
}

export function resendVerificationEmail(email: string): Promise<AcceptedDto> {
  return api.request('/auth/verify-email/resend', {
    schema: acceptedDtoSchema,
    method: 'POST',
    body: { email },
  });
}

export function requestPasswordReset(email: string): Promise<AcceptedDto> {
  return api.request('/auth/forgot-password', {
    schema: acceptedDtoSchema,
    method: 'POST',
    body: { email },
  });
}

export function resetPassword(input: ResetPasswordInput): Promise<PasswordResetDto> {
  return api.request('/auth/reset-password', {
    schema: passwordResetDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function updateProfile(input: UpdateProfileInput): Promise<UserDto> {
  return api.request('/auth/profile', { schema: userDtoSchema, method: 'PATCH', body: input });
}

/** Resolves with the rotated session; every other session of the user has been signed out. */
export function changePassword(input: ChangePasswordInput): Promise<AuthSessionDto> {
  return api.request('/auth/password', {
    schema: authSessionDtoSchema,
    method: 'POST',
    body: input,
  });
}

export function listSessions(signal?: AbortSignal): Promise<SessionListDto> {
  return api.request('/auth/sessions', { schema: sessionListDtoSchema, signal });
}

export function revokeSession(sessionId: EntityId): Promise<RevokedSessionsDto> {
  return api.request(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    schema: revokedSessionsDtoSchema,
    method: 'DELETE',
  });
}

export function revokeOtherSessions(): Promise<RevokedSessionsDto> {
  return api.request('/auth/sessions/revoke-others', {
    schema: revokedSessionsDtoSchema,
    method: 'POST',
  });
}
