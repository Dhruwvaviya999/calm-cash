import { z } from 'zod';

import {
  CSV_DELIMITERS,
  DECIMAL_SEPARATORS,
  DUPLICATE_REASONS,
  IMPORT_BATCH_STATUSES,
  IMPORT_DATE_FORMATS,
  IMPORT_FORMATS,
  IMPORT_ROW_STATUSES,
  MAX_IMPORT_FILE_NAME_LENGTH,
  MAX_IMPORT_ROWS_PER_REQUEST,
  MAX_STATEMENT_CELL_LENGTH,
  MAX_STATEMENT_COLUMNS,
  SIGN_CONVENTIONS,
  STATEMENT_DIRECTIONS,
} from '../constants/imports';
import { MAX_ENTERED_AMOUNT_MINOR } from '../constants/money';
import { TEXT_LIMITS } from '../constants/domain';
import { tryParseMinorUnits } from '../money/minor-units';
import type {
  BalanceCheckDto,
  ClassifyImportRowsInput,
  DuplicateCandidateDto,
  ImportAdjustmentInput,
  ImportBatchDetailDto,
  ImportBatchDto,
  ImportBatchListDto,
  ImportColumnMapping,
  ImportProblemDto,
  ImportProposalDto,
  ImportReconciliationDto,
  ImportRowDecisionInput,
  ImportRowDto,
  ImportRowListQuery,
  ImportRowPageDto,
  ImportRowsInput,
  ImportRowsResultDto,
  ImportSettings,
  ImportSettingsInput,
  ImportTransactionRefDto,
  ImportUploadQuery,
  StatementInfo,
  UpdateImportRowInput,
} from '../types/import';
import {
  booleanQuerySchema,
  currencyCodeSchema,
  entityIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
} from './common';
import {
  paginationDtoSchema,
  paymentMethodSchema,
  tagListSchema,
  transactionAccountRefDtoSchema,
  transactionDescriptionSchema,
  transactionMerchantSchema,
  transactionNotesSchema,
  transactionStatusSchema,
  transactionTypeSchema,
} from './transaction';

export const importFormatSchema = z.enum(IMPORT_FORMATS);
export const csvDelimiterSchema = z.enum(CSV_DELIMITERS, { error: 'Choose a separator.' });
export const importDateFormatSchema = z.enum(IMPORT_DATE_FORMATS, {
  error: 'Choose how dates are written in this statement.',
});
export const decimalSeparatorSchema = z.enum(DECIMAL_SEPARATORS);
export const signConventionSchema = z.enum(SIGN_CONVENTIONS, {
  error: 'Say whether a minus sign means money out or money in.',
});
export const statementDirectionSchema = z.enum(STATEMENT_DIRECTIONS);
export const importBatchStatusSchema = z.enum(IMPORT_BATCH_STATUSES);
export const importRowStatusSchema = z.enum(IMPORT_ROW_STATUSES);
export const duplicateReasonSchema = z.enum(DUPLICATE_REASONS);

// --- Fields --------------------------------------------------------------------------------------

/**
 * A client-supplied file name, reduced to a safe display label: the last path segment, no control
 * characters, bounded. It is never used to build a storage path.
 */
export function safeFileNameSchema(max: number): z.ZodType<string, string> {
  return z
    .string({ error: 'Name the file.' })
    .max(1000, { error: 'The file name is too long.' })
    .transform((value) =>
      (value.split(/[\\/]/).at(-1) ?? '')
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max),
    )
    .pipe(z.string().min(1, { error: 'Name the file.' }));
}

const columnSchema = z
  .number({ error: 'Choose a column.' })
  .int({ error: 'Choose a column.' })
  .min(0, { error: 'Choose a column.' })
  .max(MAX_STATEMENT_COLUMNS - 1, { error: 'Choose a column.' });

/** A signed statement balance a person typed (minor units, within the enterable range). */
const statementBalanceSchema = minorUnitsSchema.refine(
  (value) => {
    const parsed = tryParseMinorUnits(value);
    return (
      parsed !== undefined &&
      parsed <= MAX_ENTERED_AMOUNT_MINOR &&
      -parsed <= MAX_ENTERED_AMOUNT_MINOR
    );
  },
  { error: 'Enter a balance within the supported range.' },
);

const statementDateSchema = isoDateSchema.refine((value) => value >= '1900-01-01', {
  error: 'Choose a date after 1900.',
});

// --- Settings ------------------------------------------------------------------------------------

export const importColumnMappingSchema = z
  .strictObject({
    date: columnSchema,
    description: columnSchema,
    amount: z.discriminatedUnion(
      'mode',
      [
        z.strictObject({
          mode: z.literal('signed'),
          column: columnSchema,
          convention: signConventionSchema,
        }),
        z.strictObject({
          mode: z.literal('split'),
          debitColumn: columnSchema,
          creditColumn: columnSchema,
        }),
      ],
      { error: 'Choose how amounts are written.' },
    ),
    counterparty: columnSchema.exactOptional(),
    reference: columnSchema.exactOptional(),
  })
  .superRefine((mapping, context) => {
    const used: { field: string; column: number }[] = [
      { field: 'date', column: mapping.date },
      { field: 'description', column: mapping.description },
    ];
    if (mapping.amount.mode === 'signed') {
      used.push({ field: 'amount', column: mapping.amount.column });
    } else {
      used.push({ field: 'debit', column: mapping.amount.debitColumn });
      used.push({ field: 'credit', column: mapping.amount.creditColumn });
    }
    const seen = new Map<number, string>();
    for (const { field, column } of used) {
      const other = seen.get(column);
      if (other !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [field === 'debit' || field === 'credit' ? 'amount' : field],
          message: `The ${field} and ${other} cannot use the same column.`,
        });
      }
      seen.set(column, field);
    }
  }) satisfies z.ZodType<ImportColumnMapping>;

export const importSettingsSchema = z.strictObject({
  dateFormat: importDateFormatSchema,
  decimalSeparator: decimalSeparatorSchema,
  mapping: importColumnMappingSchema,
}) satisfies z.ZodType<ImportSettings>;

export const statementInfoSchema = z
  .strictObject({
    periodStart: statementDateSchema.exactOptional(),
    periodEnd: statementDateSchema.exactOptional(),
    openingBalanceMinor: statementBalanceSchema.exactOptional(),
    closingBalanceMinor: statementBalanceSchema.exactOptional(),
  })
  .refine(
    (info) =>
      info.periodStart === undefined ||
      info.periodEnd === undefined ||
      info.periodEnd >= info.periodStart,
    { error: 'The statement must end on or after its start.', path: ['periodEnd'] },
  ) satisfies z.ZodType<StatementInfo>;

// --- Requests ------------------------------------------------------------------------------------

export const importUploadQuerySchema = z.strictObject({
  accountId: entityIdSchema,
  fileName: safeFileNameSchema(MAX_IMPORT_FILE_NAME_LENGTH),
  delimiter: csvDelimiterSchema.exactOptional(),
  hasHeaderRow: booleanQuerySchema.exactOptional(),
}) satisfies z.ZodType<ImportUploadQuery>;

export const importSettingsInputSchema = z.strictObject({
  settings: importSettingsSchema,
  statement: statementInfoSchema.exactOptional(),
}) satisfies z.ZodType<ImportSettingsInput>;

export const updateImportRowInputSchema = z
  .strictObject({
    type: z.enum(['expense', 'income', 'transfer']).exactOptional(),
    transferAccountId: entityIdSchema.nullable().exactOptional(),
    description: transactionDescriptionSchema.exactOptional(),
    merchant: transactionMerchantSchema.nullable().exactOptional(),
    categoryId: entityIdSchema.nullable().exactOptional(),
    paymentMethod: paymentMethodSchema.nullable().exactOptional(),
    notes: transactionNotesSchema.nullable().exactOptional(),
    tags: tagListSchema.exactOptional(),
    occurredAt: isoDateTimeSchema
      .refine((value) => value >= '1900-01-01', { error: 'Choose a date after 1900.' })
      .exactOptional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    error: 'Provide at least one field to update.',
  }) satisfies z.ZodType<UpdateImportRowInput>;

export const importRowDecisionInputSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({ action: z.literal('match'), transactionId: entityIdSchema }),
    z.strictObject({ action: z.literal('not_duplicate') }),
    z.strictObject({ action: z.literal('skip') }),
    z.strictObject({ action: z.literal('restore') }),
  ],
  { error: 'Choose what to do with this row.' },
) satisfies z.ZodType<ImportRowDecisionInput>;

const rowIdListSchema = z
  .array(entityIdSchema)
  .min(1, { error: 'Select at least one row.' })
  .max(MAX_IMPORT_ROWS_PER_REQUEST, {
    error: `Select at most ${MAX_IMPORT_ROWS_PER_REQUEST} rows at a time.`,
  })
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Each row can be selected once.' });

export const classifyImportRowsInputSchema = z.strictObject({
  rowIds: rowIdListSchema,
  categoryId: entityIdSchema,
}) satisfies z.ZodType<ClassifyImportRowsInput>;

export const importRowsInputSchema = z.strictObject({
  rowIds: rowIdListSchema,
}) satisfies z.ZodType<ImportRowsInput>;

export const importRowListQuerySchema = z.strictObject({
  status: z.enum([...IMPORT_ROW_STATUSES, 'attention', 'open']).exactOptional(),
  page: z
    .string()
    .regex(/^[1-9]\d{0,3}$/, { error: 'Must be a positive whole number.' })
    .transform(Number)
    .default(1),
}) satisfies z.ZodType<ImportRowListQuery>;

export const importAdjustmentInputSchema = z.strictObject({
  expectedAdjustmentMinor: minorUnitsSchema.refine((value) => value !== '0', {
    error: 'There is nothing to adjust.',
  }),
  description: transactionDescriptionSchema,
}) satisfies z.ZodType<ImportAdjustmentInput>;

// --- Responses -----------------------------------------------------------------------------------

const countSchema = z.number().int().nonnegative();

export const importBatchDtoSchema = z.object({
  id: entityIdSchema,
  userId: entityIdSchema,
  account: transactionAccountRefDtoSchema,
  fileName: z.string().min(1).max(MAX_IMPORT_FILE_NAME_LENGTH),
  format: importFormatSchema,
  delimiter: csvDelimiterSchema,
  hasHeaderRow: z.boolean(),
  currency: currencyCodeSchema,
  status: importBatchStatusSchema,
  columns: z.array(z.string().max(MAX_STATEMENT_CELL_LENGTH)).max(MAX_STATEMENT_COLUMNS),
  settings: importSettingsSchema.exactOptional(),
  statement: z.object({
    periodStart: isoDateSchema.exactOptional(),
    periodEnd: isoDateSchema.exactOptional(),
    openingBalanceMinor: minorUnitsSchema.exactOptional(),
    closingBalanceMinor: minorUnitsSchema.exactOptional(),
  }),
  rowDates: z.object({ from: isoDateSchema, to: isoDateSchema }).exactOptional(),
  totalRows: countSchema,
  counts: z.object({
    invalid: countSchema,
    review: countSchema,
    ready: countSchema,
    matched: countSchema,
    imported: countSchema,
    skipped: countSchema,
    failed: countSchema,
  }),
  reconciliation: z
    .object({
      checkedAt: isoDateTimeSchema,
      differenceMinor: minorUnitsSchema.exactOptional(),
      adjustmentTransactionId: entityIdSchema.exactOptional(),
    })
    .exactOptional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.exactOptional(),
  cancelledAt: isoDateTimeSchema.exactOptional(),
}) satisfies z.ZodType<ImportBatchDto>;

export const importBatchDetailDtoSchema = z.object({
  ...importBatchDtoSchema.shape,
  sampleRows: z
    .array(z.array(z.string().max(MAX_STATEMENT_CELL_LENGTH)).max(MAX_STATEMENT_COLUMNS))
    .max(10),
  proposed: z.object({
    mapping: z.object({
      date: columnSchema.exactOptional(),
      description: columnSchema.exactOptional(),
      counterparty: columnSchema.exactOptional(),
      reference: columnSchema.exactOptional(),
      debitColumn: columnSchema.exactOptional(),
      creditColumn: columnSchema.exactOptional(),
      amountColumn: columnSchema.exactOptional(),
    }),
    dateFormats: z.array(importDateFormatSchema),
    decimalSeparator: decimalSeparatorSchema.exactOptional(),
  }),
}) satisfies z.ZodType<ImportBatchDetailDto>;

export const importBatchListDtoSchema = z.object({
  batches: z.array(importBatchDtoSchema),
}) satisfies z.ZodType<ImportBatchListDto>;

export const importProblemDtoSchema = z.object({
  field: z.enum(['date', 'amount', 'description', 'reference', 'counterparty', 'row']),
  message: z.string().min(1).max(300),
}) satisfies z.ZodType<ImportProblemDto>;

export const importTransactionRefDtoSchema = z.object({
  id: entityIdSchema,
  type: transactionTypeSchema,
  amountMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  occurredAt: isoDateTimeSchema,
  description: z.string().min(1).max(TEXT_LIMITS.transactionDescription),
  merchant: z.string().min(1).max(TEXT_LIMITS.transactionMerchant).exactOptional(),
  status: transactionStatusSchema,
}) satisfies z.ZodType<ImportTransactionRefDto>;

export const duplicateCandidateDtoSchema = z.object({
  reason: duplicateReasonSchema,
  row: z.object({ id: entityIdSchema, rowNumber: z.number().int().positive() }).exactOptional(),
  transaction: importTransactionRefDtoSchema.exactOptional(),
  importedFrom: z
    .object({
      batchId: entityIdSchema,
      fileName: z.string().min(1).max(MAX_IMPORT_FILE_NAME_LENGTH),
    })
    .exactOptional(),
  dateDifferenceDays: z.number().int().nonnegative().exactOptional(),
}) satisfies z.ZodType<DuplicateCandidateDto>;

export const importProposalDtoSchema = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  transferAccountId: entityIdSchema.exactOptional(),
  description: z.string().min(1).max(TEXT_LIMITS.transactionDescription),
  merchant: z.string().min(1).max(TEXT_LIMITS.transactionMerchant).exactOptional(),
  categoryId: entityIdSchema.exactOptional(),
  paymentMethod: paymentMethodSchema.exactOptional(),
  notes: z.string().min(1).max(TEXT_LIMITS.transactionNotes).exactOptional(),
  tags: z.array(z.string().min(1).max(TEXT_LIMITS.transactionTag)).max(10),
  occurredAt: isoDateTimeSchema,
  suggested: z.boolean(),
}) satisfies z.ZodType<ImportProposalDto>;

const importRowBaseShape = {
  id: entityIdSchema,
  batchId: entityIdSchema,
  rowNumber: z.number().int().positive(),
  date: isoDateSchema.exactOptional(),
  amountMinor: positiveMinorUnitsSchema.exactOptional(),
  direction: statementDirectionSchema.exactOptional(),
  description: z.string().max(MAX_STATEMENT_CELL_LENGTH),
  reference: z.string().min(1).max(MAX_STATEMENT_CELL_LENGTH).exactOptional(),
  counterparty: z.string().min(1).max(MAX_STATEMENT_CELL_LENGTH).exactOptional(),
  proposal: importProposalDtoSchema.exactOptional(),
  warnings: z.array(z.string().min(1).max(300)).max(10),
  duplicates: z.array(duplicateCandidateDtoSchema).max(10),
  duplicateDismissed: z.boolean(),
};

export const importRowDtoSchema = z.discriminatedUnion('status', [
  z.object({
    ...importRowBaseShape,
    status: z.literal('invalid'),
    problems: z.array(importProblemDtoSchema).min(1).max(10),
  }),
  z.object({ ...importRowBaseShape, status: z.literal('review') }),
  z.object({ ...importRowBaseShape, status: z.literal('ready') }),
  z.object({ ...importRowBaseShape, status: z.literal('matched'), transactionId: entityIdSchema }),
  z.object({ ...importRowBaseShape, status: z.literal('imported'), transactionId: entityIdSchema }),
  z.object({ ...importRowBaseShape, status: z.literal('skipped') }),
  z.object({
    ...importRowBaseShape,
    status: z.literal('failed'),
    error: z.string().min(1).max(500),
  }),
]) satisfies z.ZodType<ImportRowDto>;

export const importRowPageDtoSchema = z.object({
  items: z.array(importRowDtoSchema),
  pagination: paginationDtoSchema,
}) satisfies z.ZodType<ImportRowPageDto>;

export const importRowsResultDtoSchema = z.object({
  requested: countSchema,
  imported: countSchema,
  alreadyImported: countSchema,
  failed: countSchema,
  notReady: countSchema,
  results: z.array(
    z.object({
      rowId: entityIdSchema,
      rowNumber: z.number().int().positive(),
      outcome: z.enum(['imported', 'already_imported', 'failed', 'not_ready']),
      transactionId: entityIdSchema.exactOptional(),
      message: z.string().min(1).max(500).exactOptional(),
    }),
  ),
  batch: importBatchDtoSchema,
}) satisfies z.ZodType<ImportRowsResultDto>;

export const balanceCheckDtoSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    asOf: isoDateTimeSchema,
    statementBalanceMinor: minorUnitsSchema,
    ledgerBalanceMinor: minorUnitsSchema,
    differenceMinor: z.string().regex(/^(?:0|-?[1-9]\d*)$/),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['no_statement_balance', 'no_statement_date', 'before_tracking', 'in_future']),
  }),
]) satisfies z.ZodType<BalanceCheckDto>;

export const importReconciliationDtoSchema = z.object({
  batch: importBatchDtoSchema,
  opening: balanceCheckDtoSchema,
  closing: balanceCheckDtoSchema,
  unresolvedRows: countSchema,
}) satisfies z.ZodType<ImportReconciliationDto>;
