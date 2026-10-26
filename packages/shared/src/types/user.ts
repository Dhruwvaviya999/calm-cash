import type { CurrencyCode } from '../constants/currencies';
import type { EntityId, IsoDateTimeString, TimeZoneId } from './common';

/**
 * Public representation of a user. Credentials (password hashes) and other authentication
 * internals stored in the database must never appear here.
 */
export interface UserDto {
  id: EntityId;
  name: string;
  email: string;
  /** When the user proved ownership of `email`; absent while unverified. */
  emailVerifiedAt?: IsoDateTimeString;
  preferredCurrency: CurrencyCode;
  timezone: TimeZoneId;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
