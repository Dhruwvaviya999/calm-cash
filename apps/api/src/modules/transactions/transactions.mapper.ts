import {
  currencyCodeSchema,
  serializeMinorUnits,
  type TransactionAccountRefDto,
  type TransactionDto,
  type TransactionListItemDto,
} from '@calmcash/shared';

import type { Account } from '../../generated/prisma/client';
import type { TransactionRecord, TransactionWithRefs } from './transactions.repository';

// Database rows → public DTOs, field by field. `null` columns become absent properties, money
// becomes canonical strings, and nothing else about a row (idempotency keys) is ever exposed.

function corrupt(field: string): Error {
  return new Error(`Stored transaction violates its type invariant: missing ${field}.`);
}

export function toTransactionDto(record: TransactionRecord): TransactionDto {
  const base = {
    id: record.id,
    userId: record.userId,
    accountId: record.accountId,
    amountMinor: serializeMinorUnits(record.amountMinor),
    // The database accepts any well-formed code; the API only ever writes supported ones.
    currency: currencyCodeSchema.parse(record.currency),
    description: record.description,
    ...(record.notes === null ? {} : { notes: record.notes }),
    tags: [...record.tags],
    status: record.voidedAt === null ? ('active' as const) : ('voided' as const),
    ...(record.voidedAt === null ? {} : { voidedAt: record.voidedAt.toISOString() }),
    ...(record.voidReason === null ? {} : { voidReason: record.voidReason }),
    occurredAt: record.occurredAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  const paymentMethod =
    record.paymentMethod === null ? {} : { paymentMethod: record.paymentMethod };

  switch (record.type) {
    case 'income':
    case 'expense':
      return {
        ...base,
        type: record.type,
        ...(record.merchant === null ? {} : { merchant: record.merchant }),
        ...(record.categoryId === null ? {} : { categoryId: record.categoryId }),
        ...paymentMethod,
      };
    case 'transfer':
      if (record.transferAccountId === null) {
        throw corrupt('transferAccountId');
      }
      return {
        ...base,
        type: 'transfer',
        transferAccountId: record.transferAccountId,
        ...paymentMethod,
      };
    case 'balance_adjustment':
      if (record.adjustmentDirection === null) {
        throw corrupt('adjustmentDirection');
      }
      return {
        ...base,
        type: 'balance_adjustment',
        adjustmentDirection: record.adjustmentDirection,
      };
  }
}

function toAccountRef(account: Account): TransactionAccountRefDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: currencyCodeSchema.parse(account.currency),
    status: account.archivedAt === null ? 'active' : 'archived',
  };
}

export function toTransactionListItemDto(row: TransactionWithRefs): TransactionListItemDto {
  const { account, transferAccount, category, ...record } = row;
  return {
    transaction: toTransactionDto(record),
    account: toAccountRef(account),
    ...(transferAccount === null ? {} : { transferAccount: toAccountRef(transferAccount) }),
    ...(category === null
      ? {}
      : {
          category: {
            id: category.id,
            name: category.name,
            kind: category.kind,
            ...(category.parentId === null ? {} : { parentId: category.parentId }),
            ...(category.parent === null ? {} : { parentName: category.parent.name }),
          },
        }),
  };
}
