import { z } from 'zod';

import {
  ADJUSTMENT_DIRECTIONS,
  PAYMENT_METHODS,
  TEXT_LIMITS,
  TRANSACTION_TYPES,
} from '../constants/domain';
import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import {
  BULK_TRANSACTION_ACTIONS,
  DEFAULT_TRANSACTION_PAGE_SIZE,
  MAX_BULK_TRANSACTIONS,
  MAX_TAGS_PER_TRANSACTION,
  MAX_TRANSACTION_PAGE_SIZE,
  TRANSACTION_SORTS,
  TRANSACTION_STATUS_FILTERS,
  TRANSACTION_STATUSES,
} from '../constants/transactions';
import { AMOUNT_FILTER_PATTERN, compareAmountFilters } from '../money/amount-filter';
import { tryParseMinorUnits } from '../money/minor-units';
import { normalizeTag, normalizeTags, TAG_PATTERN } from '../transactions/tags';
import type {
  BalanceAdjustmentTransactionDto,
  BulkTransactionInput,
  BulkTransactionResultDto,
  CreateBalanceAdjustmentInput,
  CreateExpenseTransactionInput,
  CreateIncomeTransactionInput,
  CreateReconciliationInput,
  CreateTransactionInput,
  CreateTransferTransactionInput,
  CurrencyCashFlowDto,
  ExpenseTransactionDto,
  IncomeTransactionDto,
  PaginationDto,
  ReconciliationPreviewDto,
  ReconciliationPreviewInput,
  TagListDto,
  TransactionAccountRefDto,
  TransactionCategoryRefDto,
  TransactionDto,
  TransactionFilterQuery,
  TransactionListItemDto,
  TransactionListQuery,
  TransactionPageDto,
  TransactionSummaryDto,
  TransferTransactionDto,
  UpdateTransactionInput,
  VoidTransactionInput,
} from '../types/transaction';
import {
  accountBalanceDtoSchema,
  accountStatusSchema,
  accountTypeSchema,
  enteredAmountMinorSchema,
} from './account';
import { categoryKindSchema } from './category';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
} from './common';

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES, {
  error: 'Choose a transaction type.',
});
export const adjustmentDirectionSchema = z.enum(ADJUSTMENT_DIRECTIONS, {
  error: 'Choose whether the balance goes up or down.',
});
export const paymentMethodSchema = z.enum(PAYMENT_METHODS, {
  error: 'Choose a payment method from the list.',
});
export const transactionStatusSchema = z.enum(TRANSACTION_STATUSES);
export const transactionStatusFilterSchema = z.enum(TRANSACTION_STATUS_FILTERS);
export const transactionSortSchema = z.enum(TRANSACTION_SORTS);
export const bulkTransactionActionSchema = z.enum(BULK_TRANSACTION_ACTIONS);

// --- Fields --------------------------------------------------------------------------------------

/** Single-line text: no control characters at all. */
const SINGLE_LINE = /^\P{Cc}*$/u;
/** Multi-line text: line breaks and tabs are fine, other control characters are not. */
const MULTI_LINE = /^(?:\P{Cc}|[\t\n\r])*$/u;

function singleLineText(max: number, emptyMessage: string): z.ZodString {
  return z
    .string({ error: emptyMessage })
    .trim()
    .min(1, { error: emptyMessage })
    .max(max, { error: `Use at most ${max} characters.` })
    .regex(SINGLE_LINE, { error: 'Remove unsupported characters.' });
}

export const transactionDescriptionSchema = singleLineText(
  TEXT_LIMITS.transactionDescription,
  'Describe what this was for.',
);

/** Merchant or recipient of an expense, payer of income. */
export const transactionMerchantSchema = singleLineText(
  TEXT_LIMITS.transactionMerchant,
  'Enter who was paid or who paid you, or leave it empty.',
);

export const transactionNotesSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter a note, or leave it empty.' })
  .max(TEXT_LIMITS.transactionNotes, {
    error: `Use at most ${TEXT_LIMITS.transactionNotes} characters.`,
  })
  .regex(MULTI_LINE, { error: 'Remove unsupported characters.' });

export const voidReasonSchema = singleLineText(
  TEXT_LIMITS.transactionVoidReason,
  'Enter a reason, or leave it empty.',
);

/** One tag, normalised (`" Work Trip"` → `"work-trip"`) and then validated. */
export const tagSchema = z
  .string({ error: 'Enter a tag.' })
  .transform(normalizeTag)
  .pipe(
    z
      .string()
      .min(1, { error: 'Tags cannot be empty.' })
      .max(TEXT_LIMITS.transactionTag, {
        error: `Tags have at most ${TEXT_LIMITS.transactionTag} characters.`,
      })
      .regex(TAG_PATTERN, {
        error:
          'Tags use letters, digits, hyphens, and underscores, starting with a letter or digit.',
      }),
  );

/** Normalised, de-duplicated tags. */
export const tagListSchema = z
  .array(tagSchema)
  .max(MAX_TAGS_PER_TRANSACTION, {
    error: `Use at most ${MAX_TAGS_PER_TRANSACTION} tags.`,
  })
  .transform((tags) => normalizeTags(tags));

/** A transaction amount a person entered: positive, within the enterable range. */
export const transactionAmountMinorSchema = z.string({ error: 'Enter an amount.' }).refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return parsed !== undefined && parsed > 0n && parsed <= MAX_ENTERED_AMOUNT_MINOR;
  },
  { error: 'Enter an amount above zero, in minor units, e.g. "12550".' },
);

const occurredAtSchema = isoDateTimeSchema.refine((value) => value >= '1900-01-01', {
  error: 'Choose a date after 1900.',
});

const transactionIdListSchema = z
  .array(entityIdSchema)
  .min(1, { error: 'Select at least one transaction.' })
  .max(MAX_BULK_TRANSACTIONS, {
    error: `Select at most ${MAX_BULK_TRANSACTIONS} transactions at a time.`,
  })
  .refine((ids) => new Set(ids).size === ids.length, {
    error: 'Each transaction can be selected only once.',
  });

// --- Requests ------------------------------------------------------------------------------------
// Strict objects: owner IDs, currencies, statuses, and fields another type uses are rejected.

const inputBaseShape = {
  accountId: entityIdSchema,
  amountMinor: transactionAmountMinorSchema,
  occurredAt: occurredAtSchema,
  notes: transactionNotesSchema.exactOptional(),
  tags: tagListSchema.exactOptional(),
};

export const createIncomeTransactionInputSchema = z.strictObject({
  ...inputBaseShape,
  type: z.literal('income'),
  description: transactionDescriptionSchema,
  categoryId: entityIdSchema,
  merchant: transactionMerchantSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
}) satisfies z.ZodType<CreateIncomeTransactionInput>;

export const createExpenseTransactionInputSchema = z.strictObject({
  ...inputBaseShape,
  type: z.literal('expense'),
  description: transactionDescriptionSchema,
  categoryId: entityIdSchema,
  merchant: transactionMerchantSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
}) satisfies z.ZodType<CreateExpenseTransactionInput>;

export const createTransferTransactionInputSchema = z
  .strictObject({
    ...inputBaseShape,
    type: z.literal('transfer'),
    transferAccountId: entityIdSchema,
    description: transactionDescriptionSchema.exactOptional(),
    paymentMethod: paymentMethodSchema.exactOptional(),
  })
  .refine((input) => input.transferAccountId !== input.accountId, {
    error: 'Choose two different accounts.',
    path: ['transferAccountId'],
  }) satisfies z.ZodType<CreateTransferTransactionInput>;

export const createBalanceAdjustmentInputSchema = z.strictObject({
  ...inputBaseShape,
  type: z.literal('balance_adjustment'),
  adjustmentDirection: adjustmentDirectionSchema,
  description: singleLineText(
    TEXT_LIMITS.transactionDescription,
    'Explain why the balance needs correcting.',
  ),
}) satisfies z.ZodType<CreateBalanceAdjustmentInput>;

export const createTransactionInputSchema = z.discriminatedUnion(
  'type',
  [
    createIncomeTransactionInputSchema,
    createExpenseTransactionInputSchema,
    createTransferTransactionInputSchema,
    createBalanceAdjustmentInputSchema,
  ],
  { error: 'Choose a transaction type.' },
) satisfies z.ZodType<CreateTransactionInput>;

export const updateTransactionInputSchema = z
  .strictObject({
    type: transactionTypeSchema.exactOptional(),
    accountId: entityIdSchema.exactOptional(),
    transferAccountId: entityIdSchema.nullable().exactOptional(),
    amountMinor: transactionAmountMinorSchema.exactOptional(),
    occurredAt: occurredAtSchema.exactOptional(),
    description: transactionDescriptionSchema.exactOptional(),
    merchant: transactionMerchantSchema.nullable().exactOptional(),
    categoryId: entityIdSchema.nullable().exactOptional(),
    paymentMethod: paymentMethodSchema.nullable().exactOptional(),
    adjustmentDirection: adjustmentDirectionSchema.nullable().exactOptional(),
    notes: transactionNotesSchema.nullable().exactOptional(),
    tags: tagListSchema.exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateTransactionInput>;

export const voidTransactionInputSchema = z.strictObject({
  reason: voidReasonSchema.exactOptional(),
}) satisfies z.ZodType<VoidTransactionInput>;

export const reconciliationPreviewInputSchema = z.strictObject({
  accountId: entityIdSchema,
  observedBalanceMinor: enteredAmountMinorSchema,
  asOf: occurredAtSchema,
}) satisfies z.ZodType<ReconciliationPreviewInput>;

export const createReconciliationInputSchema = z.strictObject({
  accountId: entityIdSchema,
  observedBalanceMinor: enteredAmountMinorSchema,
  asOf: occurredAtSchema,
  description: singleLineText(
    TEXT_LIMITS.transactionDescription,
    'Explain why the balance needs correcting.',
  ),
  notes: transactionNotesSchema.exactOptional(),
  tags: tagListSchema.exactOptional(),
  expectedAdjustmentMinor: minorUnitsSchema.refine((value) => value !== '0', {
    error: 'There is nothing to adjust: the balances already match.',
  }),
}) satisfies z.ZodType<CreateReconciliationInput>;

export const bulkTransactionInputSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      action: z.literal('set_category'),
      transactionIds: transactionIdListSchema,
      categoryId: entityIdSchema,
    }),
    z.strictObject({
      action: z.enum(['add_tags', 'remove_tags']),
      transactionIds: transactionIdListSchema,
      tags: tagListSchema.refine((tags) => tags.length > 0, { error: 'Enter at least one tag.' }),
    }),
    z.strictObject({
      action: z.literal('void'),
      transactionIds: transactionIdListSchema,
      reason: voidReasonSchema.exactOptional(),
    }),
  ],
  { error: 'Choose a bulk action.' },
) satisfies z.ZodType<BulkTransactionInput>;

// --- Queries -------------------------------------------------------------------------------------
// Query strings arrive as text. Unknown parameters are rejected, so a misspelt filter never
// silently shows unfiltered data.

function positiveIntegerQuery(max: number): z.ZodType<number, string> {
  return z
    .string()
    .regex(/^[1-9]\d{0,5}$/, { error: 'Must be a positive whole number.' })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .max(max, { error: `Must be at most ${max}.` }),
    );
}

const amountFilterSchema = z.string().regex(AMOUNT_FILTER_PATTERN, {
  error: 'Enter an amount such as 500 or 99.99.',
});

const tagsQuerySchema = z
  .string()
  .max(MAX_TAGS_PER_TRANSACTION * (TEXT_LIMITS.transactionTag + 1))
  .transform((value) => value.split(','))
  .pipe(tagListSchema);

const transactionFilterShape = {
  q: z.string().trim().min(1).max(TEXT_LIMITS.transactionSearch).exactOptional(),
  type: transactionTypeSchema.exactOptional(),
  accountId: entityIdSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
  tags: tagsQuerySchema.exactOptional(),
  from: isoDateSchema.exactOptional(),
  to: isoDateSchema.exactOptional(),
  minAmount: amountFilterSchema.exactOptional(),
  maxAmount: amountFilterSchema.exactOptional(),
  status: transactionStatusFilterSchema.default('active'),
};

function checkFilterRanges(
  query: { from?: string; to?: string; minAmount?: string; maxAmount?: string },
  context: z.RefinementCtx,
): void {
  // ISO `YYYY-MM-DD` strings sort chronologically.
  if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'The end date must be on or after the start date.',
    });
  }
  if (
    query.minAmount !== undefined &&
    query.maxAmount !== undefined &&
    compareAmountFilters(query.minAmount, query.maxAmount) > 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maxAmount'],
      message: 'The maximum must be at least the minimum.',
    });
  }
}

export const transactionFilterQuerySchema = z
  .strictObject(transactionFilterShape)
  .superRefine(checkFilterRanges) satisfies z.ZodType<TransactionFilterQuery>;

export const transactionListQuerySchema = z
  .strictObject({
    ...transactionFilterShape,
    page: positiveIntegerQuery(100_000).default(1),
    pageSize: positiveIntegerQuery(MAX_TRANSACTION_PAGE_SIZE).default(
      DEFAULT_TRANSACTION_PAGE_SIZE,
    ),
    sort: transactionSortSchema.default('newest'),
  })
  .superRefine(checkFilterRanges) satisfies z.ZodType<TransactionListQuery>;

// --- Responses -----------------------------------------------------------------------------------

const transactionBaseShape = {
  id: entityIdSchema,
  userId: entityIdSchema,
  accountId: entityIdSchema,
  amountMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  description: z.string().min(1).max(TEXT_LIMITS.transactionDescription),
  notes: z.string().min(1).max(TEXT_LIMITS.transactionNotes).exactOptional(),
  tags: z.array(z.string().min(1).max(TEXT_LIMITS.transactionTag)).max(MAX_TAGS_PER_TRANSACTION),
  status: transactionStatusSchema,
  voidedAt: isoDateTimeSchema.exactOptional(),
  voidReason: z.string().min(1).max(TEXT_LIMITS.transactionVoidReason).exactOptional(),
  occurredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

const merchantDtoSchema = z.string().min(1).max(TEXT_LIMITS.transactionMerchant);

export const incomeTransactionDtoSchema = z.object({
  ...transactionBaseShape,
  type: z.literal('income'),
  merchant: merchantDtoSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
}) satisfies z.ZodType<IncomeTransactionDto>;

export const expenseTransactionDtoSchema = z.object({
  ...transactionBaseShape,
  type: z.literal('expense'),
  merchant: merchantDtoSchema.exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
}) satisfies z.ZodType<ExpenseTransactionDto>;

export const transferTransactionDtoSchema = z
  .object({
    ...transactionBaseShape,
    type: z.literal('transfer'),
    transferAccountId: entityIdSchema,
    paymentMethod: paymentMethodSchema.exactOptional(),
  })
  .refine((transaction) => transaction.transferAccountId !== transaction.accountId, {
    message: 'A transfer must move money between two different accounts.',
    path: ['transferAccountId'],
  }) satisfies z.ZodType<TransferTransactionDto>;

export const balanceAdjustmentTransactionDtoSchema = z.object({
  ...transactionBaseShape,
  type: z.literal('balance_adjustment'),
  adjustmentDirection: adjustmentDirectionSchema,
}) satisfies z.ZodType<BalanceAdjustmentTransactionDto>;

export const transactionDtoSchema = z
  .discriminatedUnion('type', [
    incomeTransactionDtoSchema,
    expenseTransactionDtoSchema,
    transferTransactionDtoSchema,
    balanceAdjustmentTransactionDtoSchema,
  ])
  .refine(
    (transaction) => (transaction.status === 'voided') === (transaction.voidedAt !== undefined),
    {
      message: 'Voided transactions, and only those, have a void time.',
      path: ['voidedAt'],
    },
  ) satisfies z.ZodType<TransactionDto>;

export const transactionAccountRefDtoSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.accountName),
  type: accountTypeSchema,
  currency: currencyCodeSchema,
  status: accountStatusSchema,
}) satisfies z.ZodType<TransactionAccountRefDto>;

export const transactionCategoryRefDtoSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(TEXT_LIMITS.categoryName),
  kind: categoryKindSchema,
  parentId: entityIdSchema.exactOptional(),
  parentName: z.string().min(1).max(TEXT_LIMITS.categoryName).exactOptional(),
}) satisfies z.ZodType<TransactionCategoryRefDto>;

export const transactionListItemDtoSchema = z.object({
  transaction: transactionDtoSchema,
  account: transactionAccountRefDtoSchema,
  transferAccount: transactionAccountRefDtoSchema.exactOptional(),
  category: transactionCategoryRefDtoSchema.exactOptional(),
}) satisfies z.ZodType<TransactionListItemDto>;

export const paginationDtoSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
}) satisfies z.ZodType<PaginationDto>;

export const transactionPageDtoSchema = z.object({
  items: z.array(transactionListItemDtoSchema),
  pagination: paginationDtoSchema,
}) satisfies z.ZodType<TransactionPageDto>;

export const currencyCashFlowDtoSchema = z.object({
  currency: currencyCodeSchema,
  incomeMinor: minorUnitsSchema,
  expenseMinor: minorUnitsSchema,
  netMinor: minorUnitsSchema,
  incomeCount: z.number().int().nonnegative(),
  expenseCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<CurrencyCashFlowDto>;

export const transactionSummaryDtoSchema = z.object({
  currencies: z.array(currencyCashFlowDtoSchema),
}) satisfies z.ZodType<TransactionSummaryDto>;

export const tagListDtoSchema = z.object({
  tags: z.array(
    z.object({
      tag: z.string().min(1).max(TEXT_LIMITS.transactionTag),
      count: z.number().int().nonnegative(),
    }),
  ),
}) satisfies z.ZodType<TagListDto>;

export const reconciliationPreviewDtoSchema = z.object({
  accountId: entityIdSchema,
  currency: currencyCodeSchema,
  asOf: isoDateTimeSchema,
  observedBalanceMinor: minorUnitsSchema,
  before: accountBalanceDtoSchema,
  after: accountBalanceDtoSchema,
  adjustment: z
    .object({ direction: adjustmentDirectionSchema, amountMinor: positiveMinorUnitsSchema })
    .exactOptional(),
}) satisfies z.ZodType<ReconciliationPreviewDto>;

export const bulkTransactionResultDtoSchema = z.object({
  action: bulkTransactionActionSchema,
  requested: z.number().int().positive(),
  changed: z.number().int().nonnegative(),
}) satisfies z.ZodType<BulkTransactionResultDto>;
