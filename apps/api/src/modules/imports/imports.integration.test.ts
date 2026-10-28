import {
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  importBatchDetailDtoSchema,
  importBatchDtoSchema,
  importReconciliationDtoSchema,
  importRowDtoSchema,
  importRowPageDtoSchema,
  importRowsResultDtoSchema,
  type ImportBatchDetailDto,
  type ImportRowDto,
  type ImportSettings,
} from '@calmcash/shared';
import type request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNTS,
  balanceOf,
  categoryId,
  createAccount,
  newUser,
  parseError,
  record,
} from '../../testing/finance-helpers';
import { useIntegrationDatabase, withCsrf, type SignedIn } from '../../testing/integration-harness';

const IMPORTS = `${API_V1_PREFIX}/imports`;
const { prisma, createContext } = useIntegrationDatabase();
const detailEnvelope = apiSuccessResponseSchema(importBatchDetailDtoSchema);
const resultEnvelope = apiSuccessResponseSchema(importRowsResultDtoSchema);

const SPLIT: ImportSettings = {
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: '.',
  mapping: {
    date: 0,
    description: 1,
    reference: 2,
    amount: { mode: 'split', debitColumn: 3, creditColumn: 4 },
  },
};

const STATEMENT = [
  'Txn Date,Narration,Ref No,Withdrawal Amt,Deposit Amt',
  '05/10/2026,UPI/SWIGGY/okaxis,UTR001,450.00,',
  '06/10/2026,"SALARY ACME, OCT",UTR002,,"95,000.00"',
  '07/10/2026,RENT OCT,UTR003,"25,000.00",',
  '07/10/2026,THIRD WAVE COFFEE,,120.00,',
  '07/10/2026,THIRD WAVE COFFEE,,120.00,',
  '31/02/2026,BAD DATE,UTR006,10.00,',
  '09/10/2026,BOTH SIDES,UTR007,10.00,20.00',
].join('\r\n');

function upload(
  user: SignedIn,
  accountId: string,
  content: string | Uint8Array,
  query = '',
): request.Test {
  return withCsrf(
    user.agent.post(
      `${IMPORTS}?accountId=${accountId}&fileName=${encodeURIComponent('hdfc-oct.csv')}${query}`,
    ),
    user,
  )
    .set('Content-Type', 'text/csv')
    .send(Buffer.from(content));
}

async function rowsOf(user: SignedIn, batchId: string): Promise<ImportRowDto[]> {
  const response = await user.agent.get(`${IMPORTS}/${batchId}/rows`).expect(200);
  return apiSuccessResponseSchema(importRowPageDtoSchema).parse(response.body).data.items;
}

async function settle(
  user: SignedIn,
  batchId: string,
  body: Record<string, unknown>,
): Promise<ImportBatchDetailDto> {
  const response = await withCsrf(user.agent.put(`${IMPORTS}/${batchId}/settings`), user).send(
    body,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return detailEnvelope.parse(response.body).data;
}

async function decide(
  user: SignedIn,
  batchId: string,
  rowId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return withCsrf(user.agent.post(`${IMPORTS}/${batchId}/rows/${rowId}/decision`), user).send(body);
}

function importRows(user: SignedIn, batchId: string, rowIds: string[]): request.Test {
  return withCsrf(user.agent.post(`${IMPORTS}/${batchId}/import`), user).send({ rowIds });
}

interface Setup {
  user: SignedIn;
  bank: string;
  food: string;
  salary: string;
  rent: string;
  existing: string;
}

async function setup(): Promise<Setup> {
  const user = await newUser(createContext());
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      openingBalanceMinor: '10000000',
      openingBalanceDate: '2026-09-01',
    })
  ).account.id;
  const food = await categoryId(user, 'expense', 'Food delivery');
  // Entered by hand a day after the bank's date: the import should find it.
  const existing = await record(user, {
    type: 'expense',
    accountId: bank,
    amountMinor: '45000',
    occurredAt: '2026-10-06T08:00:00.000Z',
    description: 'Swiggy dinner',
    categoryId: food,
  });
  return {
    user,
    bank,
    food,
    salary: await categoryId(user, 'income', 'Salary'),
    rent: await categoryId(user, 'expense', 'Rent'),
    existing: existing.transaction.id,
  };
}

describe('statement import', () => {
  it('maps, validates, flags duplicates, matches, and imports each row exactly once', async () => {
    const { user, bank, food, salary, rent, existing } = await setup();
    const uploaded = await upload(user, bank, STATEMENT).expect(201);
    const batch = detailEnvelope.parse(uploaded.body).data;
    expect(batch).toMatchObject({
      status: 'mapping',
      delimiter: ',',
      hasHeaderRow: true,
      currency: 'INR',
      columns: ['Txn Date', 'Narration', 'Ref No', 'Withdrawal Amt', 'Deposit Amt'],
      totalRows: 7,
      fileName: 'hdfc-oct.csv',
    });
    expect(batch.proposed.mapping).toMatchObject({
      date: 0,
      description: 1,
      reference: 2,
      debitColumn: 3,
      creditColumn: 4,
    });
    // Every day is ≤ 12, so day-first and month-first both fit: the person must choose.
    expect(batch.proposed.dateFormats).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY']);
    expect(JSON.stringify(batch)).not.toContain('storage');

    const reviewed = await settle(user, batch.id, { settings: SPLIT });
    expect(reviewed.status).toBe('reviewing');
    expect(reviewed.counts).toMatchObject({ invalid: 2, review: 3, ready: 2 });

    const rows = await rowsOf(user, batch.id);
    const byNumber = new Map(rows.map((row) => [row.rowNumber, row]));
    const swiggy = byNumber.get(2);
    expect(swiggy).toMatchObject({
      status: 'review',
      amountMinor: '45000',
      direction: 'debit',
      reference: 'UTR001',
    });
    expect(swiggy?.duplicates).toEqual([
      expect.objectContaining({ reason: 'existing_transaction', dateDifferenceDays: 1 }),
    ]);
    expect(byNumber.get(3)).toMatchObject({
      status: 'ready',
      amountMinor: '9500000',
      direction: 'credit',
      description: 'SALARY ACME, OCT',
    });
    expect(byNumber.get(5)?.duplicates[0]).toMatchObject({
      reason: 'same_details',
      row: { rowNumber: 6 },
    });
    const badDate = byNumber.get(7);
    expect(badDate?.status).toBe('invalid');
    if (badDate?.status === 'invalid') expect(badDate.problems[0]?.field).toBe('date');
    expect(byNumber.get(8)?.status).toBe('invalid');

    // Matching links the existing transaction; no money moves.
    const before = await balanceOf(user, bank);
    const matched = await decide(user, batch.id, swiggy?.id ?? '', {
      action: 'match',
      transactionId: existing,
    });
    expect(matched.status, JSON.stringify(matched.body)).toBe(200);
    expect(apiSuccessResponseSchema(importRowDtoSchema).parse(matched.body).data).toMatchObject({
      status: 'matched',
      transactionId: existing,
    });
    expect(await balanceOf(user, bank)).toBe(before);

    // Two identical coffees are genuine: say so for both.
    for (const number of [5, 6]) {
      await decide(user, batch.id, byNumber.get(number)?.id ?? '', {
        action: 'not_duplicate',
      }).then((response) => {
        expect(response.status).toBe(200);
      });
    }
    // Classify: one category for the expenses, another for the salary.
    await withCsrf(user.agent.post(`${IMPORTS}/${batch.id}/rows/classify`), user)
      .send({ rowIds: [byNumber.get(5)?.id, byNumber.get(6)?.id], categoryId: food })
      .expect(200);
    await withCsrf(
      user.agent.patch(`${IMPORTS}/${batch.id}/rows/${byNumber.get(4)?.id ?? ''}`),
      user,
    )
      .send({ categoryId: rent, description: 'October rent', merchant: 'Mr. Kulkarni' })
      .expect(200);
    const salaryRow = await withCsrf(
      user.agent.patch(`${IMPORTS}/${batch.id}/rows/${byNumber.get(3)?.id ?? ''}`),
      user,
    )
      .send({ categoryId: salary })
      .expect(200);
    expect(
      apiSuccessResponseSchema(importRowDtoSchema).parse(salaryRow.body).data.proposal?.categoryId,
    ).toBe(salary);
    // An expense category cannot classify income.
    await withCsrf(
      user.agent.patch(`${IMPORTS}/${batch.id}/rows/${byNumber.get(3)?.id ?? ''}`),
      user,
    )
      .send({ categoryId: food })
      .expect(400);

    const selected = [3, 4, 5, 6, 7, 2].map((number) => byNumber.get(number)?.id ?? '');
    const result = resultEnvelope.parse(
      (await importRows(user, batch.id, selected).expect(200)).body,
    ).data;
    expect(result).toMatchObject({
      requested: 6,
      imported: 4,
      alreadyImported: 0,
      failed: 0,
      notReady: 2,
    });
    expect(result.results.find((entry) => entry.rowNumber === 7)?.message).toContain(
      'cannot be read',
    );
    expect(result.results.find((entry) => entry.rowNumber === 2)?.message).toContain('matched');
    // +95,000 − 25,000 − 120 − 120, exactly.
    expect(await balanceOf(user, bank)).toBe(before + 9_500_000n - 2_500_000n - 24_000n);
    const rentTransaction = await prisma.transaction.findFirstOrThrow({
      where: { description: 'October rent' },
    });
    expect(rentTransaction).toMatchObject({
      amountMinor: 2_500_000n,
      merchant: 'Mr. Kulkarni',
      currency: 'INR',
    });

    // Repeating the request imports nothing new.
    const again = resultEnvelope.parse(
      (await importRows(user, batch.id, selected).expect(200)).body,
    ).data;
    expect(again).toMatchObject({ imported: 0, alreadyImported: 4 });
    expect(await prisma.transaction.count({ where: { userId: user.session.user.id } })).toBe(5);

    // The same file again, in a new import: everything already recorded is recognised.
    const second = detailEnvelope.parse(
      (await upload(user, bank, STATEMENT).expect(201)).body,
    ).data;
    const secondBatch = await settle(user, second.id, { settings: SPLIT });
    expect(secondBatch.counts).toMatchObject({ review: 5, ready: 0, invalid: 2 });
    const secondRows = await rowsOf(user, second.id);
    expect(secondRows.find((row) => row.rowNumber === 4)?.duplicates[0]).toMatchObject({
      reason: 'previously_imported',
      importedFrom: { batchId: batch.id, fileName: 'hdfc-oct.csv' },
    });
    // Already-linked transactions are not offered as new matches.
    const linkedAgain = await decide(
      user,
      second.id,
      secondRows.find((row) => row.rowNumber === 2)?.id ?? '',
      {
        action: 'match',
        transactionId: existing,
      },
    );
    expect(linkedAgain.status).toBe(409);
  });

  it('keeps failed rows for retry and never leaves half an import behind', async () => {
    const user = await newUser(createContext());
    const cash = (
      await createAccount(user, {
        name: 'Wallet',
        type: 'cash',
        currency: 'INR',
        openingBalanceMinor: '10000',
        openingBalanceDate: '2026-09-01',
      })
    ).account.id;
    const groceries = await categoryId(user, 'expense', 'Groceries');
    const csv = 'Date,Description,Amount\n2026-10-05,Big shop,-500.00\n';
    const batch = detailEnvelope.parse((await upload(user, cash, csv).expect(201)).body).data;
    await settle(user, batch.id, {
      settings: {
        dateFormat: 'YYYY-MM-DD',
        decimalSeparator: '.',
        mapping: {
          date: 0,
          description: 1,
          amount: { mode: 'signed', column: 2, convention: 'negative_is_debit' },
        },
      },
    });
    const [row] = await rowsOf(user, batch.id);
    await withCsrf(user.agent.patch(`${IMPORTS}/${batch.id}/rows/${row?.id ?? ''}`), user)
      .send({ categoryId: groceries })
      .expect(200);
    const failed = resultEnvelope.parse(
      (await importRows(user, batch.id, [row?.id ?? '']).expect(200)).body,
    ).data;
    expect(failed).toMatchObject({ imported: 0, failed: 1 });
    expect(failed.results[0]?.message).toContain('below zero');
    expect((await rowsOf(user, batch.id))[0]).toMatchObject({ status: 'failed' });
    expect(await balanceOf(user, cash)).toBe(10_000n);
    expect(await prisma.transaction.count({ where: { userId: user.session.user.id } })).toBe(0);

    // Add money, then retry: the same row imports once.
    await record(user, {
      type: 'income',
      accountId: cash,
      amountMinor: '100000',
      occurredAt: '2026-10-04T06:00:00.000Z',
      description: 'ATM withdrawal',
      categoryId: await categoryId(user, 'income', 'Other'),
    });
    const retried = resultEnvelope.parse(
      (await importRows(user, batch.id, [row?.id ?? '']).expect(200)).body,
    ).data;
    expect(retried).toMatchObject({ imported: 1, failed: 0 });
    expect(await balanceOf(user, cash)).toBe(60_000n);
  });

  it('imports each row once even when the same request arrives several times at once', async () => {
    const { user, bank, food } = await setup();
    const lines = ['Date,Description,Amount'];
    for (let day = 10; day < 20; day += 1)
      lines.push(`2026-10-${String(day)},Order ${String(day)},-${String(day)}.00`);
    const batch = detailEnvelope.parse(
      (await upload(user, bank, lines.join('\n')).expect(201)).body,
    ).data;
    await settle(user, batch.id, {
      settings: {
        dateFormat: 'YYYY-MM-DD',
        decimalSeparator: '.',
        mapping: {
          date: 0,
          description: 1,
          amount: { mode: 'signed', column: 2, convention: 'negative_is_debit' },
        },
      },
    });
    const rows = await rowsOf(user, batch.id);
    const ids = rows.map((row) => row.id);
    await withCsrf(user.agent.post(`${IMPORTS}/${batch.id}/rows/classify`), user)
      .send({ rowIds: ids, categoryId: food })
      .expect(200);
    const before = await balanceOf(user, bank);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => importRows(user, batch.id, ids)),
    );
    const results = responses.map((response) => resultEnvelope.parse(response.body).data);
    expect(results.reduce((sum, result) => sum + result.imported, 0)).toBe(10);
    expect(results.every((result) => result.failed === 0)).toBe(true);
    const imported = await prisma.statementImportRow.findMany({ where: { batchId: batch.id } });
    expect(imported.every((row) => row.status === 'imported')).toBe(true);
    expect(new Set(imported.map((row) => row.importedTransactionId)).size).toBe(10);
    expect(await prisma.transaction.count({ where: { userId: user.session.user.id } })).toBe(11);
    // 10 + 11 + … + 19 rupees.
    expect(await balanceOf(user, bank)).toBe(before - 14_500n);
  });

  it('rolls the transaction back when the row cannot be marked imported', async () => {
    const context = createContext({
      importsRepository: (real) => ({
        ...real,
        storeFor: (db) => ({
          ...real.storeFor(db),
          updateRow: () => Promise.reject(new Error('Simulated failure')),
        }),
      }),
    });
    const user = await newUser(context);
    const bank = (
      await createAccount(user, {
        name: 'HDFC',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '100000',
        openingBalanceDate: '2026-09-01',
      })
    ).account.id;
    const food = await categoryId(user, 'expense', 'Food delivery');
    const batch = detailEnvelope.parse(
      (await upload(user, bank, 'Date,Description,Amount\n2026-10-05,Lunch,-100.00').expect(201))
        .body,
    ).data;
    await settle(user, batch.id, {
      settings: {
        dateFormat: 'YYYY-MM-DD',
        decimalSeparator: '.',
        mapping: {
          date: 0,
          description: 1,
          amount: { mode: 'signed', column: 2, convention: 'negative_is_debit' },
        },
      },
    });
    const [row] = await rowsOf(user, batch.id);
    await withCsrf(user.agent.patch(`${IMPORTS}/${batch.id}/rows/${row?.id ?? ''}`), user)
      .send({ categoryId: food })
      .expect(200);
    const result = resultEnvelope.parse(
      (await importRows(user, batch.id, [row?.id ?? '']).expect(200)).body,
    ).data;
    expect(result).toMatchObject({ imported: 0, failed: 1 });
    expect(await prisma.transaction.count({ where: { userId: user.session.user.id } })).toBe(0);
    expect(await balanceOf(user, bank)).toBe(100_000n);
    expect((await rowsOf(user, batch.id))[0]?.status).toBe('failed');
  });

  it('compares statement balances with the ledger at the statement end and corrects only on approval', async () => {
    const { user, bank, food } = await setup();
    const batch = detailEnvelope.parse(
      (
        await upload(user, bank, 'Date,Description,Amount\n2026-10-10,Groceries,-1000.00').expect(
          201,
        )
      ).body,
    ).data;
    // Opening ₹1,00,000 on 1 Sep; the hand-entered Swiggy (₹450) is the only October movement.
    await settle(user, batch.id, {
      settings: {
        dateFormat: 'YYYY-MM-DD',
        decimalSeparator: '.',
        mapping: {
          date: 0,
          description: 1,
          amount: { mode: 'signed', column: 2, convention: 'negative_is_debit' },
        },
      },
      statement: {
        periodStart: '2026-10-01',
        periodEnd: '2026-10-15',
        openingBalanceMinor: '10000000',
        closingBalanceMinor: '9844000',
      },
    });
    // A later transaction must not affect the comparison at the statement's end.
    await record(user, {
      type: 'expense',
      accountId: bank,
      amountMinor: '777700',
      occurredAt: '2026-10-20T06:00:00.000Z',
      description: 'After the statement',
      categoryId: food,
    });
    const before = apiSuccessResponseSchema(importReconciliationDtoSchema).parse(
      (await user.agent.get(`${IMPORTS}/${batch.id}/reconciliation`).expect(200)).body,
    ).data;
    expect(before.opening).toMatchObject({
      status: 'available',
      ledgerBalanceMinor: '10000000',
      differenceMinor: '0',
    });
    // Statement 98,440 vs ledger 99,550 (the ₹1,000 row is not imported yet): −1,110.00.
    expect(before.closing).toMatchObject({
      status: 'available',
      statementBalanceMinor: '9844000',
      ledgerBalanceMinor: '9955000',
      differenceMinor: '-111000',
    });
    expect(before.unresolvedRows).toBe(1);
    // Nothing is corrected automatically.
    expect(await prisma.transaction.count({ where: { type: 'balance_adjustment' } })).toBe(0);

    const [row] = await rowsOf(user, batch.id);
    await withCsrf(user.agent.patch(`${IMPORTS}/${batch.id}/rows/${row?.id ?? ''}`), user)
      .send({ categoryId: food })
      .expect(200);
    await importRows(user, batch.id, [row?.id ?? '']).expect(200);
    const afterImport = apiSuccessResponseSchema(importReconciliationDtoSchema).parse(
      (await user.agent.get(`${IMPORTS}/${batch.id}/reconciliation`).expect(200)).body,
    ).data;
    expect(afterImport.closing).toMatchObject({ differenceMinor: '-11000' });

    // A stale approval is refused; the reviewed one is recorded through the existing reconciliation.
    await withCsrf(user.agent.post(`${IMPORTS}/${batch.id}/reconciliation/adjustment`), user)
      .send({ expectedAdjustmentMinor: '-111000', description: 'Bank fees' })
      .expect(409);
    const adjusted = apiSuccessResponseSchema(importReconciliationDtoSchema).parse(
      (
        await withCsrf(user.agent.post(`${IMPORTS}/${batch.id}/reconciliation/adjustment`), user)
          .send({ expectedAdjustmentMinor: '-11000', description: 'Bank fees' })
          .expect(201)
      ).body,
    ).data;
    expect(adjusted.closing).toMatchObject({ differenceMinor: '0' });
    expect(adjusted.batch.reconciliation?.adjustmentTransactionId).toBeDefined();
    const adjustment = await prisma.transaction.findFirstOrThrow({
      where: { type: 'balance_adjustment' },
    });
    expect(adjustment).toMatchObject({ amountMinor: 11_000n, adjustmentDirection: 'decrease' });

    const completed = apiSuccessResponseSchema(importBatchDtoSchema).parse(
      (await withCsrf(user.agent.post(`${IMPORTS}/${batch.id}/complete`), user).expect(200)).body,
    ).data;
    expect(completed).toMatchObject({
      status: 'completed',
      reconciliation: { differenceMinor: '0' },
    });
    const rows = await prisma.statementImportRow.findMany({ where: { batchId: batch.id } });
    expect(rows.every((entry) => entry.cells.length === 0)).toBe(true);
  });

  it('refuses unusable files, archived accounts, bad mappings, and other users', async () => {
    const { user, bank } = await setup();
    const pdf = await upload(user, bank, '%PDF-1.7 fake statement').expect(400);
    expect(parseError(pdf.body).details?.[0]?.message).toContain('PDF');
    await upload(user, bank, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])).expect(400);
    await upload(user, bank, '').expect(400);
    await upload(user, bank, 'only,a,header\n').expect(400);
    await upload(user, '0193a000-0000-7000-8000-000000000999', STATEMENT).expect(400);
    await withCsrf(user.agent.post(`${IMPORTS}?accountId=${bank}&fileName=x.csv`), user)
      .set('Content-Type', 'text/csv')
      .send(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))
      .expect(413);

    const batch = detailEnvelope.parse((await upload(user, bank, STATEMENT).expect(201)).body).data;
    await withCsrf(user.agent.put(`${IMPORTS}/${batch.id}/settings`), user)
      .send({ settings: { ...SPLIT, mapping: { ...SPLIT.mapping, date: 9 } } })
      .expect(400);
    await withCsrf(user.agent.put(`${IMPORTS}/${batch.id}/settings`), user)
      .send({
        settings: {
          ...SPLIT,
          mapping: { ...SPLIT.mapping, amount: { mode: 'signed', column: 3 } },
        },
      })
      .expect(400);

    const other = await newUser(createContext());
    await other.agent.get(`${IMPORTS}/${batch.id}`).expect(404);
    await other.agent.get(`${IMPORTS}/${batch.id}/rows`).expect(404);
    await withCsrf(other.agent.put(`${IMPORTS}/${batch.id}/settings`), other)
      .send({ settings: SPLIT })
      .expect(404);
    await withCsrf(other.agent.post(`${IMPORTS}/${batch.id}/cancel`), other).expect(404);
    await upload(other, bank, STATEMENT).expect(400);

    await withCsrf(user.agent.post(`${ACCOUNTS}/${bank}/archive`), user).expect(200);
    await upload(user, bank, STATEMENT).expect(409);

    const cancelled = apiSuccessResponseSchema(importBatchDtoSchema).parse(
      (await withCsrf(user.agent.post(`${IMPORTS}/${batch.id}/cancel`), user).expect(200)).body,
    ).data;
    expect(cancelled.status).toBe('cancelled');
    // Cancelling never removes ledger history.
    expect(await prisma.transaction.count({ where: { userId: user.session.user.id } })).toBe(1);
  });
});
