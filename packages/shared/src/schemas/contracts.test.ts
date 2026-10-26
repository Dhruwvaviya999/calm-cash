import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { AccountDto } from '../types/account';
import type { ApiErrorResponse } from '../types/api';
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
import type { BudgetDto } from '../types/budget';
import type { CategoryDto } from '../types/category';
import type { HealthCheckDto, ReadinessCheckDto } from '../types/health';
import type { TransactionDto } from '../types/transaction';
import type { UserDto } from '../types/user';
import type { accountDtoSchema } from './account';
import type { apiErrorResponseSchema } from './api';
import type {
  acceptedDtoSchema,
  authSessionDtoSchema,
  changePasswordInputSchema,
  emailVerifiedDtoSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  passwordResetDtoSchema,
  registerInputSchema,
  registrationDtoSchema,
  resendVerificationInputSchema,
  resetPasswordInputSchema,
  revokedSessionsDtoSchema,
  sessionDtoSchema,
  sessionListDtoSchema,
  signedOutDtoSchema,
  updateProfileInputSchema,
  verifyEmailInputSchema,
} from './auth';
import type { budgetDtoSchema } from './budget';
import type { categoryDtoSchema } from './category';
import type { healthCheckDtoSchema, readinessCheckDtoSchema } from './health';
import type { transactionDtoSchema } from './transaction';
import type { userDtoSchema } from './user';

// These assertions are verified by `tsc` (pnpm typecheck). They fail the build if a Zod schema
// and its hand-written interface drift apart — including optional-vs-required differences.
describe('schema ⇄ interface contracts', () => {
  it('infers exactly the published DTO types', () => {
    expectTypeOf<z.output<typeof userDtoSchema>>().toEqualTypeOf<UserDto>();
    expectTypeOf<z.output<typeof accountDtoSchema>>().toEqualTypeOf<AccountDto>();
    expectTypeOf<z.output<typeof categoryDtoSchema>>().toEqualTypeOf<CategoryDto>();
    expectTypeOf<z.output<typeof transactionDtoSchema>>().toEqualTypeOf<TransactionDto>();
    expectTypeOf<z.output<typeof budgetDtoSchema>>().toEqualTypeOf<BudgetDto>();
    expectTypeOf<z.output<typeof healthCheckDtoSchema>>().toEqualTypeOf<HealthCheckDto>();
    expectTypeOf<z.output<typeof readinessCheckDtoSchema>>().toEqualTypeOf<ReadinessCheckDto>();
    expectTypeOf<z.output<typeof apiErrorResponseSchema>>().toEqualTypeOf<ApiErrorResponse>();
  });

  it('infers exactly the authentication request and response types', () => {
    expectTypeOf<z.output<typeof registerInputSchema>>().toEqualTypeOf<RegisterInput>();
    expectTypeOf<z.output<typeof loginInputSchema>>().toEqualTypeOf<LoginInput>();
    expectTypeOf<z.output<typeof verifyEmailInputSchema>>().toEqualTypeOf<VerifyEmailInput>();
    expectTypeOf<
      z.output<typeof resendVerificationInputSchema>
    >().toEqualTypeOf<ResendVerificationInput>();
    expectTypeOf<z.output<typeof forgotPasswordInputSchema>>().toEqualTypeOf<ForgotPasswordInput>();
    expectTypeOf<z.output<typeof resetPasswordInputSchema>>().toEqualTypeOf<ResetPasswordInput>();
    expectTypeOf<z.output<typeof changePasswordInputSchema>>().toEqualTypeOf<ChangePasswordInput>();
    expectTypeOf<z.output<typeof updateProfileInputSchema>>().toEqualTypeOf<UpdateProfileInput>();

    expectTypeOf<z.output<typeof authSessionDtoSchema>>().toEqualTypeOf<AuthSessionDto>();
    expectTypeOf<z.output<typeof registrationDtoSchema>>().toEqualTypeOf<RegistrationDto>();
    expectTypeOf<z.output<typeof acceptedDtoSchema>>().toEqualTypeOf<AcceptedDto>();
    expectTypeOf<z.output<typeof emailVerifiedDtoSchema>>().toEqualTypeOf<EmailVerifiedDto>();
    expectTypeOf<z.output<typeof passwordResetDtoSchema>>().toEqualTypeOf<PasswordResetDto>();
    expectTypeOf<z.output<typeof signedOutDtoSchema>>().toEqualTypeOf<SignedOutDto>();
    expectTypeOf<z.output<typeof sessionDtoSchema>>().toEqualTypeOf<SessionDto>();
    expectTypeOf<z.output<typeof sessionListDtoSchema>>().toEqualTypeOf<SessionListDto>();
    expectTypeOf<z.output<typeof revokedSessionsDtoSchema>>().toEqualTypeOf<RevokedSessionsDto>();
  });
});
