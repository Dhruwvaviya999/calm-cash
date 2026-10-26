import {
  currencyCodeSchema,
  getAccountClassification,
  serializeMinorUnits,
  type AccountDto,
} from '@calmcash/shared';

import type { AccountRecord } from './accounts.repository';

/** `YYYY-MM-DD` of a PostgreSQL `date` column (Prisma returns it as UTC midnight). */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** UTC midnight of a `YYYY-MM-DD` calendar date, for a `date` column. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Database account → public DTO, field by field; nothing else about the row is exposed. */
export function toAccountDto(account: AccountRecord): AccountDto {
  return {
    id: account.id,
    userId: account.userId,
    name: account.name,
    type: account.type,
    classification: getAccountClassification(account.type),
    // The database accepts any well-formed code; the API only ever writes supported ones.
    currency: currencyCodeSchema.parse(account.currency),
    openingBalanceMinor: serializeMinorUnits(account.openingBalanceMinor),
    openingBalanceDate: toIsoDate(account.openingBalanceDate),
    ...(account.institution === null ? {} : { institution: account.institution }),
    ...(account.creditLimitMinor === null
      ? {}
      : { creditLimitMinor: serializeMinorUnits(account.creditLimitMinor) }),
    ...(account.color === null ? {} : { color: account.color }),
    status: account.archivedAt === null ? 'active' : 'archived',
    ...(account.archivedAt === null ? {} : { archivedAt: account.archivedAt.toISOString() }),
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
