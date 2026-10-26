import { z } from 'zod';

import {
  AUTH_TOKEN_PATTERN,
  COMMON_PASSWORDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../constants/auth';
import { TEXT_LIMITS } from '../constants/domain';
import type {
  AcceptedDto,
  AuthSessionDto,
  ChangePasswordInput,
  EmailVerifiedDto,
  ForgotPasswordInput,
  LoginInput,
  PasswordResetDto,
  RegisterInput,
  RegistrationDto,
  ResendVerificationInput,
  ResetPasswordInput,
  RevokedSessionsDto,
  SessionDto,
  SessionListDto,
  SignedOutDto,
  UpdateProfileInput,
  VerifyEmailInput,
} from '../types/auth';
import { currencyCodeSchema, entityIdSchema, isoDateTimeSchema, timeZoneSchema } from './common';
import { userDtoSchema } from './user';

// --- Building blocks ---------------------------------------------------------------------------

/** Trims and lower-cases before validating, so `" Asha@Example.com "` matches `asha@example.com`. */
export const emailAddressSchema = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ error: 'Enter a valid email address, such as name@example.com.' })
      .max(TEXT_LIMITS.email, { error: 'This email address is too long.' }),
  );

/** A person's display name: trimmed, non-empty, without control characters. */
export const personNameSchema = z
  .string({ error: 'Enter your name.' })
  .trim()
  .min(1, { error: 'Enter your name.' })
  .max(TEXT_LIMITS.userName, { error: `Use at most ${TEXT_LIMITS.userName} characters.` })
  .regex(/^\P{Cc}*$/u, { error: 'Remove unsupported characters from your name.' });

const COMMON_PASSWORD_SET: ReadonlySet<string> = new Set(COMMON_PASSWORDS);

/** True when the password is on the deny-list or is a single character repeated. */
export function isWeakPassword(password: string): boolean {
  return COMMON_PASSWORD_SET.has(password.toLowerCase()) || /^(.)\1*$/su.test(password);
}

/**
 * Policy for a password being set (registration, reset, change): length-based with a small
 * deny-list. Never trimmed, because spaces are legitimate characters in a passphrase.
 */
export const newPasswordSchema = z
  .string({ error: 'Enter a password.' })
  .min(PASSWORD_MIN_LENGTH, { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Use at most ${PASSWORD_MAX_LENGTH} characters.` })
  .refine((value) => !isWeakPassword(value), {
    error: 'This password is too easy to guess. Try a longer phrase or a password manager.',
  });

/** An existing password being checked (login, current password): bounded, never judged. */
export const currentPasswordSchema = z
  .string({ error: 'Enter your password.' })
  .min(1, { error: 'Enter your password.' })
  .max(PASSWORD_MAX_LENGTH, { error: 'This password is too long.' });

/** A token from an e-mailed link. */
export const authTokenSchema = z
  .string({ error: 'This link is incomplete.' })
  .regex(AUTH_TOKEN_PATTERN, { error: 'This link is invalid or incomplete.' });

const PASSWORDS_DO_NOT_MATCH = 'The passwords do not match.';

// --- Requests ----------------------------------------------------------------------------------
// Strict objects: unknown keys (e.g. `emailVerifiedAt`, `userId`) are rejected, never ignored, so
// a request can never assign fields it is not meant to control.

export const registerInputSchema = z
  .strictObject({
    name: personNameSchema,
    email: emailAddressSchema,
    password: newPasswordSchema,
    passwordConfirmation: z.string({ error: 'Confirm your password.' }),
  })
  .refine((input) => input.password === input.passwordConfirmation, {
    path: ['passwordConfirmation'],
    error: PASSWORDS_DO_NOT_MATCH,
  })
  .refine((input) => input.password.toLowerCase() !== input.email, {
    path: ['password'],
    error: 'Your password cannot be your email address.',
  }) satisfies z.ZodType<RegisterInput>;

export const loginInputSchema = z.strictObject({
  email: emailAddressSchema,
  password: currentPasswordSchema,
}) satisfies z.ZodType<LoginInput>;

export const verifyEmailInputSchema = z.strictObject({
  token: authTokenSchema,
}) satisfies z.ZodType<VerifyEmailInput>;

export const resendVerificationInputSchema = z.strictObject({
  email: emailAddressSchema,
}) satisfies z.ZodType<ResendVerificationInput>;

export const forgotPasswordInputSchema = z.strictObject({
  email: emailAddressSchema,
}) satisfies z.ZodType<ForgotPasswordInput>;

export const resetPasswordInputSchema = z
  .strictObject({
    token: authTokenSchema,
    password: newPasswordSchema,
    passwordConfirmation: z.string({ error: 'Confirm your new password.' }),
  })
  .refine((input) => input.password === input.passwordConfirmation, {
    path: ['passwordConfirmation'],
    error: PASSWORDS_DO_NOT_MATCH,
  }) satisfies z.ZodType<ResetPasswordInput>;

export const changePasswordInputSchema = z
  .strictObject({
    currentPassword: currentPasswordSchema,
    newPassword: newPasswordSchema,
    newPasswordConfirmation: z.string({ error: 'Confirm your new password.' }),
  })
  .refine((input) => input.newPassword === input.newPasswordConfirmation, {
    path: ['newPasswordConfirmation'],
    error: PASSWORDS_DO_NOT_MATCH,
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    path: ['newPassword'],
    error: 'Choose a password different from your current one.',
  }) satisfies z.ZodType<ChangePasswordInput>;

export const updateProfileInputSchema = z
  .strictObject({
    name: personNameSchema.exactOptional(),
    preferredCurrency: currencyCodeSchema.exactOptional(),
    timezone: timeZoneSchema.exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateProfileInput>;

// --- Responses ---------------------------------------------------------------------------------

export const authSessionDtoSchema = z.object({
  user: userDtoSchema,
  csrfToken: z.string().regex(AUTH_TOKEN_PATTERN),
  sessionId: entityIdSchema,
  expiresAt: isoDateTimeSchema,
}) satisfies z.ZodType<AuthSessionDto>;

export const registrationDtoSchema = z.object({
  email: z.email(),
  verificationRequired: z.literal(true),
}) satisfies z.ZodType<RegistrationDto>;

export const acceptedDtoSchema = z.object({
  accepted: z.literal(true),
}) satisfies z.ZodType<AcceptedDto>;

export const emailVerifiedDtoSchema = z.object({
  emailVerified: z.literal(true),
}) satisfies z.ZodType<EmailVerifiedDto>;

export const passwordResetDtoSchema = z.object({
  passwordReset: z.literal(true),
}) satisfies z.ZodType<PasswordResetDto>;

export const signedOutDtoSchema = z.object({
  signedOut: z.literal(true),
}) satisfies z.ZodType<SignedOutDto>;

export const sessionDtoSchema = z.object({
  id: entityIdSchema,
  deviceLabel: z.string().min(1).max(100).exactOptional(),
  createdAt: isoDateTimeSchema,
  lastActiveAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  current: z.boolean(),
}) satisfies z.ZodType<SessionDto>;

export const sessionListDtoSchema = z.object({
  sessions: z.array(sessionDtoSchema),
}) satisfies z.ZodType<SessionListDto>;

export const revokedSessionsDtoSchema = z.object({
  revokedCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<RevokedSessionsDto>;
