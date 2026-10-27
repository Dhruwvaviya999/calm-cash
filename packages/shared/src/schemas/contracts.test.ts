import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type {
  AccountBalanceDto,
  AccountDto,
  AccountListDto,
  AccountListQuery,
  AccountSummaryDto,
  AccountWithBalanceDto,
  CreateAccountInput,
  CurrencyBalanceSummaryDto,
  UpdateAccountInput,
} from '../types/account';
import type { ApiErrorResponse } from '../types/api';
import type {
  DashboardCategoriesDto,
  DashboardOverviewDto,
  DashboardQuery,
  DashboardTrendsDto,
} from '../types/dashboard';
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
import type {
  CategoryDto,
  CategoryListDto,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../types/category';
import type { HealthCheckDto, ReadinessCheckDto } from '../types/health';
import type {
  BulkTransactionInput,
  BulkTransactionResultDto,
  CreateReconciliationInput,
  CreateTransactionInput,
  ReconciliationPreviewDto,
  ReconciliationPreviewInput,
  TagListDto,
  TransactionDto,
  TransactionFilterQuery,
  TransactionListItemDto,
  TransactionListQuery,
  TransactionPageDto,
  TransactionSummaryDto,
  UpdateTransactionInput,
  VoidTransactionInput,
} from '../types/transaction';
import type { UserDto } from '../types/user';
import type {
  accountBalanceDtoSchema,
  accountDtoSchema,
  accountListDtoSchema,
  accountListQuerySchema,
  accountSummaryDtoSchema,
  accountWithBalanceDtoSchema,
  createAccountInputSchema,
  currencyBalanceSummaryDtoSchema,
  updateAccountInputSchema,
} from './account';
import type { apiErrorResponseSchema } from './api';
import type {
  dashboardCategoriesDtoSchema,
  dashboardOverviewDtoSchema,
  dashboardQuerySchema,
  dashboardTrendsDtoSchema,
} from './dashboard';
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
import type {
  categoryDtoSchema,
  categoryListDtoSchema,
  createCategoryInputSchema,
  updateCategoryInputSchema,
} from './category';
import type { healthCheckDtoSchema, readinessCheckDtoSchema } from './health';
import type {
  bulkTransactionInputSchema,
  bulkTransactionResultDtoSchema,
  createReconciliationInputSchema,
  createTransactionInputSchema,
  reconciliationPreviewDtoSchema,
  reconciliationPreviewInputSchema,
  tagListDtoSchema,
  transactionDtoSchema,
  transactionFilterQuerySchema,
  transactionListItemDtoSchema,
  transactionListQuerySchema,
  transactionPageDtoSchema,
  transactionSummaryDtoSchema,
  updateTransactionInputSchema,
  voidTransactionInputSchema,
} from './transaction';
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

  it('infers exactly the account request and response types', () => {
    expectTypeOf<z.output<typeof createAccountInputSchema>>().toEqualTypeOf<CreateAccountInput>();
    expectTypeOf<z.output<typeof updateAccountInputSchema>>().toEqualTypeOf<UpdateAccountInput>();
    expectTypeOf<z.output<typeof accountListQuerySchema>>().toEqualTypeOf<AccountListQuery>();
    expectTypeOf<z.output<typeof accountBalanceDtoSchema>>().toEqualTypeOf<AccountBalanceDto>();
    expectTypeOf<
      z.output<typeof accountWithBalanceDtoSchema>
    >().toEqualTypeOf<AccountWithBalanceDto>();
    expectTypeOf<z.output<typeof accountListDtoSchema>>().toEqualTypeOf<AccountListDto>();
    expectTypeOf<
      z.output<typeof currencyBalanceSummaryDtoSchema>
    >().toEqualTypeOf<CurrencyBalanceSummaryDto>();
    expectTypeOf<z.output<typeof accountSummaryDtoSchema>>().toEqualTypeOf<AccountSummaryDto>();
  });

  it('infers exactly the transaction request and response types', () => {
    expectTypeOf<
      z.output<typeof createTransactionInputSchema>
    >().toEqualTypeOf<CreateTransactionInput>();
    expectTypeOf<
      z.output<typeof updateTransactionInputSchema>
    >().toEqualTypeOf<UpdateTransactionInput>();
    expectTypeOf<
      z.output<typeof voidTransactionInputSchema>
    >().toEqualTypeOf<VoidTransactionInput>();
    expectTypeOf<
      z.output<typeof reconciliationPreviewInputSchema>
    >().toEqualTypeOf<ReconciliationPreviewInput>();
    expectTypeOf<
      z.output<typeof createReconciliationInputSchema>
    >().toEqualTypeOf<CreateReconciliationInput>();
    expectTypeOf<
      z.output<typeof bulkTransactionInputSchema>
    >().toEqualTypeOf<BulkTransactionInput>();
    expectTypeOf<
      z.output<typeof transactionFilterQuerySchema>
    >().toEqualTypeOf<TransactionFilterQuery>();
    expectTypeOf<
      z.output<typeof transactionListQuerySchema>
    >().toEqualTypeOf<TransactionListQuery>();

    expectTypeOf<
      z.output<typeof transactionListItemDtoSchema>
    >().toEqualTypeOf<TransactionListItemDto>();
    expectTypeOf<z.output<typeof transactionPageDtoSchema>>().toEqualTypeOf<TransactionPageDto>();
    expectTypeOf<
      z.output<typeof transactionSummaryDtoSchema>
    >().toEqualTypeOf<TransactionSummaryDto>();
    expectTypeOf<z.output<typeof tagListDtoSchema>>().toEqualTypeOf<TagListDto>();
    expectTypeOf<
      z.output<typeof reconciliationPreviewDtoSchema>
    >().toEqualTypeOf<ReconciliationPreviewDto>();
    expectTypeOf<
      z.output<typeof bulkTransactionResultDtoSchema>
    >().toEqualTypeOf<BulkTransactionResultDto>();
  });

  it('infers exactly the category request and response types', () => {
    expectTypeOf<z.output<typeof createCategoryInputSchema>>().toEqualTypeOf<CreateCategoryInput>();
    expectTypeOf<z.output<typeof updateCategoryInputSchema>>().toEqualTypeOf<UpdateCategoryInput>();
    expectTypeOf<z.output<typeof categoryListDtoSchema>>().toEqualTypeOf<CategoryListDto>();
  });

  it('infers exactly the dashboard query and response types', () => {
    expectTypeOf<z.output<typeof dashboardQuerySchema>>().toEqualTypeOf<DashboardQuery>();
    expectTypeOf<
      z.output<typeof dashboardOverviewDtoSchema>
    >().toEqualTypeOf<DashboardOverviewDto>();
    expectTypeOf<z.output<typeof dashboardTrendsDtoSchema>>().toEqualTypeOf<DashboardTrendsDto>();
    expectTypeOf<
      z.output<typeof dashboardCategoriesDtoSchema>
    >().toEqualTypeOf<DashboardCategoriesDto>();
  });
});
