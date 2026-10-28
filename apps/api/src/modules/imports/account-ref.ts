import { currencyCodeSchema, type TransactionAccountRefDto } from '@calmcash/shared';

import type { Account } from '../../generated/prisma/client';

/** An account as import views name it. */
export function toAccountRef(account: Account): TransactionAccountRefDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: currencyCodeSchema.parse(account.currency),
    status: account.archivedAt === null ? 'active' : 'archived',
  };
}
