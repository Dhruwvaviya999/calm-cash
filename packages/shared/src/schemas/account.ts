import { z } from 'zod';

import {
  ACCOUNT_CLASSIFICATIONS,
  ACCOUNT_COLORS,
  ACCOUNT_STATUS_FILTERS,
  ACCOUNT_STATUSES,
  CREATABLE_ACCOUNT_TYPES,
  EARLIEST_OPENING_BALANCE_DATE,
  getAccountClassification,
  requiresNonNegativeBalance,
  supportsCreditLimit,
} from '../constants/accounts';
import { ACCOUNT_TYPES, TEXT_LIMITS, type AccountType } from '../constants/domain';
import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import { tryParseMinorUnits } from '../money/minor-units';
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
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
} from './common';

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const creatableAccountTypeSchema = z.enum(CREATABLE_ACCOUNT_TYPES, {
  error: 'Choose an account type.',
});
export const accountClassificationSchema = z.enum(ACCOUNT_CLASSIFICATIONS);
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export const accountStatusFilterSchema = z.enum(ACCOUNT_STATUS_FILTERS);
export const accountColorSchema = z.enum(ACCOUNT_COLORS);

const NO_CONTROL_CHARACTERS = /^\P{Cc}*$/u;

export const accountNameSchema = z
  .string({ error: 'Enter a name for this account.' })
  .trim()
  .min(1, { error: 'Enter a name for this account.' })
  .max(TEXT_LIMITS.accountName, { error: `Use at most ${TEXT_LIMITS.accountName} characters.` })
  .regex(NO_CONTROL_CHARACTERS, { error: 'Remove unsupported characters.' });

export const accountInstitutionSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter the bank or provider, or leave it empty.' })
  .max(TEXT_LIMITS.accountInstitution, {
    error: `Use at most ${TEXT_LIMITS.accountInstitution} characters.`,
  })
  .regex(NO_CONTROL_CHARACTERS, { error: 'Remove unsupported characters.' });

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** A signed amount a person entered: canonical minor units within ±`MAX_ENTERED_AMOUNT_MINOR`. */
export const enteredAmountMinorSchema = z.string({ error: 'Enter an amount.' }).refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return parsed !== undefined && absolute(parsed) <= MAX_ENTERED_AMOUNT_MINOR;
  },
  { error: 'Enter a whole number of minor units within the supported range, e.g. "1250050".' },
);

/** A strictly positive entered amount, such as a credit limit. */
export const creditLimitMinorSchema = z.string({ error: 'Enter a credit limit.' }).refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return parsed !== undefined && parsed > 0n && parsed <= MAX_ENTERED_AMOUNT_MINOR;
  },
  { error: 'A credit limit must be a positive amount.' },
);

export const openingBalanceDateSchema = isoDateSchema.refine(
  (value) => value >= EARLIEST_OPENING_BALANCE_DATE,
  { error: 'Choose a date after 1900.' },
);

// --- Cross-field rules ---------------------------------------------------------------------------

export interface AccountRuleState {
  type: AccountType;
  openingBalanceMinor: string;
  creditLimitMinor?: string | null | undefined;
}

export interface AccountRuleViolation {
  path: 'openingBalanceMinor' | 'creditLimitMinor';
  message: string;
}

/**
 * Rules that depend on the account type. The API applies them to the merged state of an update as
 * well, so a partial update can never produce an invalid account.
 */
export function accountRuleViolations(state: AccountRuleState): AccountRuleViolation[] {
  const violations: AccountRuleViolation[] = [];
  const opening = tryParseMinorUnits(state.openingBalanceMinor);

  if (opening !== undefined && opening < 0n && requiresNonNegativeBalance(state.type)) {
    violations.push({
      path: 'openingBalanceMinor',
      message: 'This type of account cannot have a negative balance.',
    });
  }
  const hasLimit = state.creditLimitMinor !== undefined && state.creditLimitMinor !== null;
  if (hasLimit && !supportsCreditLimit(state.type)) {
    violations.push({
      path: 'creditLimitMinor',
      message: 'Only credit cards have a credit limit.',
    });
  }
  return violations;
}

// --- Requests ------------------------------------------------------------------------------------
// Strict objects: `id`, `userId`, `status`, timestamps, and any other unknown field are rejected.

export const createAccountInputSchema = z
  .strictObject({
    name: accountNameSchema,
    type: creatableAccountTypeSchema,
    currency: currencyCodeSchema,
    openingBalanceMinor: enteredAmountMinorSchema,
    openingBalanceDate: openingBalanceDateSchema.exactOptional(),
    institution: accountInstitutionSchema.exactOptional(),
    creditLimitMinor: creditLimitMinorSchema.exactOptional(),
    color: accountColorSchema.exactOptional(),
  })
  .superRefine((input, context) => {
    for (const violation of accountRuleViolations(input)) {
      context.addIssue({ code: 'custom', path: [violation.path], message: violation.message });
    }
  }) satisfies z.ZodType<CreateAccountInput>;

export const updateAccountInputSchema = z
  .strictObject({
    name: accountNameSchema.exactOptional(),
    type: creatableAccountTypeSchema.exactOptional(),
    currency: currencyCodeSchema.exactOptional(),
    openingBalanceMinor: enteredAmountMinorSchema.exactOptional(),
    openingBalanceDate: openingBalanceDateSchema.exactOptional(),
    institution: accountInstitutionSchema.nullable().exactOptional(),
    creditLimitMinor: creditLimitMinorSchema.nullable().exactOptional(),
    color: accountColorSchema.nullable().exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateAccountInput>;

export const accountListQuerySchema = z.object({
  status: accountStatusFilterSchema.default('active'),
  type: accountTypeSchema.exactOptional(),
}) satisfies z.ZodType<AccountListQuery>;

// --- Responses -----------------------------------------------------------------------------------

export const accountDtoSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(TEXT_LIMITS.accountName),
    type: accountTypeSchema,
    classification: accountClassificationSchema,
    currency: currencyCodeSchema,
    openingBalanceMinor: minorUnitsSchema,
    openingBalanceDate: isoDateSchema,
    institution: z.string().min(1).max(TEXT_LIMITS.accountInstitution).exactOptional(),
    creditLimitMinor: minorUnitsSchema.exactOptional(),
    color: accountColorSchema.exactOptional(),
    status: accountStatusSchema,
    archivedAt: isoDateTimeSchema.exactOptional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((account, context) => {
    if (account.classification !== getAccountClassification(account.type)) {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Classification does not match the account type.',
      });
    }
    if ((account.status === 'archived') !== (account.archivedAt !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['archivedAt'],
        message: 'Archived accounts, and only those, have an archive time.',
      });
    }
  }) satisfies z.ZodType<AccountDto>;

export const accountBalanceDtoSchema = z.object({
  currentBalanceMinor: minorUnitsSchema,
  amountOwedMinor: minorUnitsSchema.exactOptional(),
  availableCreditMinor: minorUnitsSchema.exactOptional(),
  countedTransactions: z.number().int().nonnegative(),
}) satisfies z.ZodType<AccountBalanceDto>;

export const accountWithBalanceDtoSchema = z.object({
  account: accountDtoSchema,
  balance: accountBalanceDtoSchema,
  hasTransactions: z.boolean(),
}) satisfies z.ZodType<AccountWithBalanceDto>;

export const accountListDtoSchema = z.object({
  accounts: z.array(accountWithBalanceDtoSchema),
}) satisfies z.ZodType<AccountListDto>;

export const currencyBalanceSummaryDtoSchema = z.object({
  currency: currencyCodeSchema,
  assetsMinor: minorUnitsSchema,
  liabilitiesMinor: minorUnitsSchema,
  assetAccounts: z.number().int().nonnegative(),
  liabilityAccounts: z.number().int().nonnegative(),
}) satisfies z.ZodType<CurrencyBalanceSummaryDto>;

export const accountSummaryDtoSchema = z.object({
  currencies: z.array(currencyBalanceSummaryDtoSchema),
}) satisfies z.ZodType<AccountSummaryDto>;
