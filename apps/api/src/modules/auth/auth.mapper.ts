import { currencyCodeSchema, type SessionDto, type UserDto } from '@calmcash/shared';

import type { SessionRecord, UserRecord } from './auth.repository';

/**
 * Database user → public DTO. Built field by field (never by spreading the record), so columns
 * such as `passwordHash` can never reach a response, even if the model grows.
 */
export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    ...(user.emailVerifiedAt === null
      ? {}
      : { emailVerifiedAt: user.emailVerifiedAt.toISOString() }),
    // The database accepts any well-formed code; the API only ever writes supported ones.
    preferredCurrency: currencyCodeSchema.parse(user.preferredCurrency),
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** Session → DTO without the token or CSRF hashes. */
export function toSessionDto(session: SessionRecord, currentSessionId: string): SessionDto {
  return {
    id: session.id,
    ...(session.deviceLabel === null ? {} : { deviceLabel: session.deviceLabel }),
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    current: session.id === currentSessionId,
  };
}
