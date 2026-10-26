import { describe, expect, it } from 'vitest';

import { isValidTag, normalizeTag, normalizeTags } from './tags';

describe('tag normalisation', () => {
  it('lower-cases, trims, and hyphenates', () => {
    expect(normalizeTag('  Work Trip ')).toBe('work-trip');
    expect(normalizeTag('Re-imbursable')).toBe('re-imbursable');
    expect(normalizeTag('a  \t b')).toBe('a-b');
  });

  it('removes duplicates and blanks while keeping order', () => {
    expect(normalizeTags(['Family', 'work', 'family', '  ', 'WORK'])).toEqual(['family', 'work']);
  });

  it('validates the permitted characters and length', () => {
    expect(isValidTag('work_2026')).toBe(true);
    expect(isValidTag('ग्रॉसरी')).toBe(true);
    expect(isValidTag('')).toBe(false);
    expect(isValidTag('_work')).toBe(false);
    expect(isValidTag('work!')).toBe(false);
    expect(isValidTag('x'.repeat(33))).toBe(false);
  });
});
