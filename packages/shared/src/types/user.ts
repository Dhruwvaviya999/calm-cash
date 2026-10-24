import type { CurrencyCode } from '../constants/currencies';
import type { EntityId, IsoDateTimeString, TimeZoneId } from './common';

/**
 * Public representation of a user. Credentials and other sensitive columns that may be added to
 * the database model later must never appear here.
 */
export interface UserDto {
  id: EntityId;
  name: string;
  email: string;
  preferredCurrency: CurrencyCode;
  timezone: TimeZoneId;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
