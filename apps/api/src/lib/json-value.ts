import type { Prisma } from '../generated/prisma/client';

/**
 * A plain value as Prisma JSON input. DTO interfaces carry no index signature, so they are copied
 * field by field (absent fields stay absent) instead of being cast.
 */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toInputJson(item));
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined && item !== null) copy[key] = toInputJson(item);
    }
    return copy;
  }
  return '';
}
