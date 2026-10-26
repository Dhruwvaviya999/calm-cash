import type { CurrencyCode } from '../constants/currencies';
import type { EntityId, IsoDateTimeString, TimeZoneId } from './common';
import type { UserDto } from './user';

// --- Requests ----------------------------------------------------------------------------------
// Each interface is the *parsed* shape of a request body (e-mail addresses trimmed and lower-cased,
// names trimmed). The matching `*InputSchema` validates it on both the web client and the API.

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface VerifyEmailInput {
  token: string;
}

export interface ResendVerificationInput {
  email: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
  passwordConfirmation: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
}

/** Only these profile fields can change; e-mail, password, and verification state cannot. */
export interface UpdateProfileInput {
  name?: string;
  preferredCurrency?: CurrencyCode;
  timezone?: TimeZoneId;
}

// --- Responses ---------------------------------------------------------------------------------

/**
 * The signed-in state returned by login, the current-session endpoint, and password changes.
 * The session token itself travels only in an HttpOnly cookie and never appears in a body.
 */
export interface AuthSessionDto {
  user: UserDto;
  /** Send as the `x-csrf-token` header on state-changing requests. Keep it in memory only. */
  csrfToken: string;
  sessionId: EntityId;
  /** Absolute end of the session; the API may end it earlier after inactivity. */
  expiresAt: IsoDateTimeString;
}

/**
 * Registration outcome. Deliberately identical whether or not the address already had an account,
 * so the response cannot be used to discover registered e-mail addresses.
 */
export interface RegistrationDto {
  email: string;
  verificationRequired: true;
}

/** Generic acknowledgement that never reveals whether an account exists for the address. */
export interface AcceptedDto {
  accepted: true;
}

export interface EmailVerifiedDto {
  emailVerified: true;
}

export interface PasswordResetDto {
  passwordReset: true;
}

export interface SignedOutDto {
  signedOut: true;
}

/** One of the current user's active sessions. Tokens and their hashes are never exposed. */
export interface SessionDto {
  id: EntityId;
  /** Coarse description such as "Chrome on Windows"; absent when it could not be determined. */
  deviceLabel?: string;
  createdAt: IsoDateTimeString;
  lastActiveAt: IsoDateTimeString;
  expiresAt: IsoDateTimeString;
  /** True for the session that made this request. */
  current: boolean;
}

export interface SessionListDto {
  sessions: SessionDto[];
}

export interface RevokedSessionsDto {
  revokedCount: number;
}
