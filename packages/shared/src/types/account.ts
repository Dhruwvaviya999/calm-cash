import type { CurrencyCode } from '../constants/currencies';
import type { AccountType } from '../constants/domain';
import type { EntityId, IsoDateTimeString, MinorUnitsString } from './common';

export interface AccountDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Signed balance when tracking started; negative for liabilities such as credit cards. */
  openingBalanceMinor: MinorUnitsString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
