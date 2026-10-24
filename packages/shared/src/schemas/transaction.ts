import { z } from 'zod';

import { TEXT_LIMITS, TRANSACTION_TYPES } from '../constants/domain';
import type {
  ExpenseTransactionDto,
  IncomeTransactionDto,
  TransactionDto,
  TransferTransactionDto,
} from '../types/transaction';
import {
  currencyCodeSchema,
  entityIdSchema,
  isoDateTimeSchema,
  positiveMinorUnitsSchema,
} from './common';

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

const transactionBaseShape = {
  id: entityIdSchema,
  userId: entityIdSchema,
  accountId: entityIdSchema,
  amountMinor: positiveMinorUnitsSchema,
  currency: currencyCodeSchema,
  description: z.string().min(1).max(TEXT_LIMITS.transactionDescription),
  merchant: z.string().min(1).max(TEXT_LIMITS.transactionMerchant).exactOptional(),
  notes: z.string().max(TEXT_LIMITS.transactionNotes).exactOptional(),
  occurredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

export const incomeTransactionDtoSchema = z.object({
  ...transactionBaseShape,
  type: z.literal('income'),
  categoryId: entityIdSchema.exactOptional(),
}) satisfies z.ZodType<IncomeTransactionDto>;

export const expenseTransactionDtoSchema = z.object({
  ...transactionBaseShape,
  type: z.literal('expense'),
  categoryId: entityIdSchema.exactOptional(),
}) satisfies z.ZodType<ExpenseTransactionDto>;

export const transferTransactionDtoSchema = z
  .object({
    ...transactionBaseShape,
    type: z.literal('transfer'),
    transferAccountId: entityIdSchema,
  })
  .refine((transaction) => transaction.transferAccountId !== transaction.accountId, {
    message: 'A transfer must move money between two different accounts.',
    path: ['transferAccountId'],
  }) satisfies z.ZodType<TransferTransactionDto>;

export const transactionDtoSchema = z.discriminatedUnion('type', [
  incomeTransactionDtoSchema,
  expenseTransactionDtoSchema,
  transferTransactionDtoSchema,
]) satisfies z.ZodType<TransactionDto>;
