import {
  MAX_STATEMENT_CELL_LENGTH,
  MAX_STATEMENT_COLUMNS,
  MAX_STATEMENT_ROWS,
} from '@calmcash/shared';
import { describe, expect, it } from 'vitest';

import {
  CsvParseError,
  decodeCsvText,
  detectDelimiter,
  parseCsv,
  readStatement,
} from './csv-parser';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function failure(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof CsvParseError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('decodeCsvText', () => {
  it('drops a UTF-8 byte-order mark and keeps non-ASCII text', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode('Date,Description\n1,Café ₹')]);
    expect(decodeCsvText(bytes)).toBe('Date,Description\n1,Café ₹');
  });

  it('refuses binary content whatever the file is called', () => {
    expect(failure(() => decodeCsvText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])))).toBe(
      'spreadsheet',
    );
    expect(failure(() => decodeCsvText(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1])))).toBe(
      'spreadsheet',
    );
    expect(failure(() => decodeCsvText(encode('%PDF-1.7\n...')))).toBe('pdf');
    expect(failure(() => decodeCsvText(new Uint8Array([0x61, 0xff, 0xfe, 0x62])))).toBe('not_text');
    expect(failure(() => decodeCsvText(encode('a,b\u0000,c')))).toBe('not_text');
  });
});

describe('parseCsv', () => {
  it('reads quoted separators, escaped quotes, and line breaks inside quotes', () => {
    const text =
      'Date,Description,Amount\r\n01/10/2026,"Coffee, beans","-120.50"\r\n02/10/2026,"He said ""hi""\nthen left",500\r\n';
    expect(parseCsv(text, ',')).toEqual([
      ['Date', 'Description', 'Amount'],
      ['01/10/2026', 'Coffee, beans', '-120.50'],
      ['02/10/2026', 'He said "hi"\nthen left', '500'],
    ]);
  });

  it('handles LF, CRLF, and CR line endings and drops empty lines', () => {
    expect(parseCsv('a;b\n1;2\n\n', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a;b\r\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\r1\t2\r', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('refuses unterminated quotes and resource-heavy input', () => {
    expect(failure(() => parseCsv('a,"b\n1,2', ','))).toBe('unterminated_quote');
    expect(failure(() => parseCsv(`a,${'x'.repeat(MAX_STATEMENT_CELL_LENGTH + 1)}`, ','))).toBe(
      'cell_too_long',
    );
    expect(
      failure(() =>
        parseCsv(Array.from({ length: MAX_STATEMENT_COLUMNS + 1 }, () => 'x').join(','), ','),
      ),
    ).toBe('too_many_columns');
    const many = Array.from({ length: MAX_STATEMENT_ROWS + 2 }, () => '1,2').join('\n');
    expect(failure(() => parseCsv(many, ','))).toBe('too_many_rows');
    expect(failure(() => parseCsv('\n\n', ','))).toBe('empty');
  });
});

describe('detectDelimiter and readStatement', () => {
  it('detects comma, semicolon, tab, and pipe separators', () => {
    expect(detectDelimiter('Date,Narration,Amount\n1,a,2\n')).toBe(',');
    expect(detectDelimiter('Datum;Omschrijving;Bedrag\n1;a;2,50\n')).toBe(';');
    expect(detectDelimiter('Date\tDesc\tAmount\n1\ta\t2\n')).toBe('\t');
    expect(detectDelimiter('Date|Desc|Amount\n1|a|2\n')).toBe('|');
  });

  it('refuses a file with a single column', () => {
    expect(failure(() => readStatement(encode('just one value\nanother'), undefined))).toBe(
      'single_column',
    );
  });

  it('uses an explicit separator when given', () => {
    expect(readStatement(encode('a;b,c\n1;2,3'), ';').records).toEqual([
      ['a', 'b,c'],
      ['1', '2,3'],
    ]);
  });
});
