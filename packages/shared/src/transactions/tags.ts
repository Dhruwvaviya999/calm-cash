import { TEXT_LIMITS } from '../constants/domain';

// Tags are short, free-form labels such as `work` or `reimbursable`. They are normalised the same
// way everywhere (web form, API, filters), so `Work Trip` and `work-trip` are one tag.

/** A letter or digit first, then letters, marks, digits, `-`, or `_`. */
export const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*$/u;

/** Trims, lower-cases, and joins words with hyphens: `"  Work Trip "` → `"work-trip"`. */
export function normalizeTag(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

export function isValidTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= TEXT_LIMITS.transactionTag && TAG_PATTERN.test(tag);
}

/** Normalises every tag and removes duplicates, keeping the first occurrence's position. */
export function normalizeTags(tags: readonly string[]): string[] {
  const unique: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (normalized !== '' && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
}
