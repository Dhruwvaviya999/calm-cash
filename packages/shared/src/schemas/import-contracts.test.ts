import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type {
  BalanceCheckDto,
  ClassifyImportRowsInput,
  DuplicateCandidateDto,
  ImportAdjustmentInput,
  ImportBatchDetailDto,
  ImportBatchDto,
  ImportBatchListDto,
  ImportColumnMapping,
  ImportProposalDto,
  ImportReconciliationDto,
  ImportRowDecisionInput,
  ImportRowDto,
  ImportRowListQuery,
  ImportRowPageDto,
  ImportRowsInput,
  ImportRowsResultDto,
  ImportSettings,
  ImportSettingsInput,
  ImportUploadQuery,
  StatementInfo,
  UpdateImportRowInput,
} from '../types/import';
import type { ReceiptDto, ReceiptListDto, ReceiptUploadQuery } from '../types/receipt';
import {
  classifyImportRowsInputSchema,
  importAdjustmentInputSchema,
  importColumnMappingSchema,
  importRowDecisionInputSchema,
  importRowDtoSchema,
  importRowListQuerySchema,
  importRowsInputSchema,
  importSettingsInputSchema,
  importSettingsSchema,
  importUploadQuerySchema,
  safeFileNameSchema,
  statementInfoSchema,
  updateImportRowInputSchema,
  type balanceCheckDtoSchema,
  type duplicateCandidateDtoSchema,
  type importBatchDetailDtoSchema,
  type importBatchDtoSchema,
  type importBatchListDtoSchema,
  type importProposalDtoSchema,
  type importReconciliationDtoSchema,
  type importRowPageDtoSchema,
  type importRowsResultDtoSchema,
} from './import';
import { receiptDtoSchema, receiptUploadQuerySchema, type receiptListDtoSchema } from './receipt';

describe('import and receipt schema ⇄ interface contracts', () => {
  it('infers exactly the import request types', () => {
    expectTypeOf<z.output<typeof importColumnMappingSchema>>().toEqualTypeOf<ImportColumnMapping>();
    expectTypeOf<z.output<typeof importSettingsSchema>>().toEqualTypeOf<ImportSettings>();
    expectTypeOf<z.output<typeof statementInfoSchema>>().toEqualTypeOf<StatementInfo>();
    expectTypeOf<z.output<typeof importUploadQuerySchema>>().toEqualTypeOf<ImportUploadQuery>();
    expectTypeOf<z.output<typeof importSettingsInputSchema>>().toEqualTypeOf<ImportSettingsInput>();
    expectTypeOf<
      z.output<typeof updateImportRowInputSchema>
    >().toEqualTypeOf<UpdateImportRowInput>();
    expectTypeOf<
      z.output<typeof importRowDecisionInputSchema>
    >().toEqualTypeOf<ImportRowDecisionInput>();
    expectTypeOf<
      z.output<typeof classifyImportRowsInputSchema>
    >().toEqualTypeOf<ClassifyImportRowsInput>();
    expectTypeOf<z.output<typeof importRowsInputSchema>>().toEqualTypeOf<ImportRowsInput>();
    expectTypeOf<z.output<typeof importRowListQuerySchema>>().toEqualTypeOf<ImportRowListQuery>();
    expectTypeOf<
      z.output<typeof importAdjustmentInputSchema>
    >().toEqualTypeOf<ImportAdjustmentInput>();
  });

  it('infers exactly the import response types', () => {
    expectTypeOf<z.output<typeof importBatchDtoSchema>>().toEqualTypeOf<ImportBatchDto>();
    expectTypeOf<
      z.output<typeof importBatchDetailDtoSchema>
    >().toEqualTypeOf<ImportBatchDetailDto>();
    expectTypeOf<z.output<typeof importBatchListDtoSchema>>().toEqualTypeOf<ImportBatchListDto>();
    expectTypeOf<
      z.output<typeof duplicateCandidateDtoSchema>
    >().toEqualTypeOf<DuplicateCandidateDto>();
    expectTypeOf<z.output<typeof importProposalDtoSchema>>().toEqualTypeOf<ImportProposalDto>();
    expectTypeOf<z.output<typeof importRowDtoSchema>>().toEqualTypeOf<ImportRowDto>();
    expectTypeOf<z.output<typeof importRowPageDtoSchema>>().toEqualTypeOf<ImportRowPageDto>();
    expectTypeOf<z.output<typeof importRowsResultDtoSchema>>().toEqualTypeOf<ImportRowsResultDto>();
    expectTypeOf<z.output<typeof balanceCheckDtoSchema>>().toEqualTypeOf<BalanceCheckDto>();
    expectTypeOf<
      z.output<typeof importReconciliationDtoSchema>
    >().toEqualTypeOf<ImportReconciliationDto>();
  });

  it('infers exactly the receipt types', () => {
    expectTypeOf<z.output<typeof receiptDtoSchema>>().toEqualTypeOf<ReceiptDto>();
    expectTypeOf<z.output<typeof receiptListDtoSchema>>().toEqualTypeOf<ReceiptListDto>();
    expectTypeOf<z.output<typeof receiptUploadQuerySchema>>().toEqualTypeOf<ReceiptUploadQuery>();
  });
});

describe('import request rules', () => {
  const settings = {
    dateFormat: 'DD/MM/YYYY',
    decimalSeparator: '.',
    mapping: {
      date: 0,
      description: 1,
      amount: { mode: 'signed', column: 2, convention: 'negative_is_debit' },
    },
  };

  it('requires an explicit sign convention for a signed amount column', () => {
    const missing = importSettingsSchema.safeParse({
      ...settings,
      mapping: { ...settings.mapping, amount: { mode: 'signed', column: 2 } },
    });
    expect(missing.success).toBe(false);
    expect(importSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('refuses one column used for two values, and unknown fields', () => {
    expect(
      importColumnMappingSchema.safeParse({
        date: 0,
        description: 0,
        amount: { mode: 'split', debitColumn: 2, creditColumn: 3 },
      }).success,
    ).toBe(false);
    expect(
      importColumnMappingSchema.safeParse({
        date: 0,
        description: 1,
        amount: { mode: 'split', debitColumn: 2, creditColumn: 2 },
      }).success,
    ).toBe(false);
    expect(importSettingsInputSchema.safeParse({ settings, extra: true }).success).toBe(false);
  });

  it('refuses a statement that ends before it starts', () => {
    const result = statementInfoSchema.safeParse({
      periodStart: '2026-10-31',
      periodEnd: '2026-10-01',
    });
    expect(result.success).toBe(false);
  });

  it('keeps only a safe display name of an uploaded file', () => {
    const name = safeFileNameSchema(120);
    expect(name.parse('../../etc/passwd')).toBe('passwd');
    expect(name.parse('C:\\Users\\me\\statement.csv')).toBe('statement.csv');
    expect(name.parse('bill\u0000\u202e.pdf')).toBe('bill.pdf');
    expect(name.parse(`${'a'.repeat(200)}.csv`)).toHaveLength(120);
    expect(name.safeParse('../').success).toBe(false);
  });

  it('accepts upload query flags as strings and only known delimiters', () => {
    expect(
      importUploadQuerySchema.parse({
        accountId: '0193a000-0000-7000-8000-000000000201',
        fileName: 'october.csv',
        hasHeaderRow: 'false',
        delimiter: ';',
      }),
    ).toMatchObject({ hasHeaderRow: false, delimiter: ';' });
    expect(
      importUploadQuerySchema.safeParse({
        accountId: '0193a000-0000-7000-8000-000000000201',
        fileName: 'october.csv',
        delimiter: ':',
      }).success,
    ).toBe(false);
  });

  it('never adjusts by zero and bounds rows per import request', () => {
    expect(
      importAdjustmentInputSchema.safeParse({ expectedAdjustmentMinor: '0', description: 'Fix' })
        .success,
    ).toBe(false);
    const ids = Array.from(
      { length: 201 },
      (_, index) => `0193a000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(importRowsInputSchema.safeParse({ rowIds: ids }).success).toBe(false);
    expect(importRowsInputSchema.safeParse({ rowIds: ids.slice(0, 200) }).success).toBe(true);
  });

  it('only lets a row be matched to a transaction it names', () => {
    expect(importRowDecisionInputSchema.safeParse({ action: 'match' }).success).toBe(false);
    expect(importRowDecisionInputSchema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(importRowDecisionInputSchema.parse({ action: 'skip' })).toEqual({ action: 'skip' });
  });
});

describe('import row rules', () => {
  const ROW = '0193a000-0000-7000-8000-000000000601';

  it('pages rows by status, with the attention and open groups', () => {
    expect(importRowListQuerySchema.parse({})).toEqual({ page: 1 });
    expect(importRowListQuerySchema.parse({ status: 'attention', page: '3' })).toEqual({
      status: 'attention',
      page: 3,
    });
    expect(importRowListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(importRowListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('refuses an empty row change and clears optional fields with null', () => {
    expect(updateImportRowInputSchema.safeParse({}).success).toBe(false);
    expect(updateImportRowInputSchema.parse({ categoryId: null, merchant: null })).toEqual({
      categoryId: null,
      merchant: null,
    });
    expect(updateImportRowInputSchema.safeParse({ type: 'balance_adjustment' }).success).toBe(
      false,
    );
  });

  it('classifies rows with one category, at most a request at a time', () => {
    expect(classifyImportRowsInputSchema.safeParse({ rowIds: [], categoryId: ROW }).success).toBe(
      false,
    );
    expect(
      classifyImportRowsInputSchema.safeParse({ rowIds: [ROW], categoryId: ROW }).success,
    ).toBe(true);
  });

  it('keeps status-specific fields on the right rows', () => {
    const base = {
      id: ROW,
      batchId: ROW,
      rowNumber: 2,
      description: 'UPI/BigBasket',
      warnings: [],
      duplicates: [],
      duplicateDismissed: false,
    };
    expect(importRowDtoSchema.safeParse({ ...base, status: 'imported' }).success).toBe(false);
    expect(
      importRowDtoSchema.safeParse({ ...base, status: 'imported', transactionId: ROW }).success,
    ).toBe(true);
    expect(importRowDtoSchema.safeParse({ ...base, status: 'invalid', problems: [] }).success).toBe(
      false,
    );
  });
});

describe('receipt rules', () => {
  it('describes a receipt by its content type and digest only', () => {
    const receipt = {
      id: '0193a000-0000-7000-8000-000000000401',
      transactionId: '0193a000-0000-7000-8000-000000000301',
      fileName: 'dinner.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
      createdAt: '2026-10-26T05:15:00.000Z',
    };
    expect(receiptDtoSchema.safeParse(receipt).success).toBe(true);
    expect(receiptDtoSchema.safeParse({ ...receipt, contentType: 'image/svg+xml' }).success).toBe(
      false,
    );
    expect(receiptDtoSchema.safeParse({ ...receipt, sha256: 'xyz' }).success).toBe(false);
    expect(receiptUploadQuerySchema.parse({ fileName: '/tmp/../receipt.png' })).toEqual({
      fileName: 'receipt.png',
    });
  });
});
