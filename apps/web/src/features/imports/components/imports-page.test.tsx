// @vitest-environment jsdom
import type {
  AccountWithBalanceDto,
  CategoryDto,
  ImportBatchDetailDto,
  ImportReconciliationDto,
  ImportRowDto,
  ImportRowPageDto,
  ImportRowsResultDto,
} from '@calmcash/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '@/testing/auth';

import { ImportsPage } from './imports-page';

// --- Mocks ---------------------------------------------------------------------------------------

const navigation = vi.hoisted(() => {
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const set = (href: string): void => {
    search = new URLSearchParams(href.split('?')[1] ?? '');
    for (const listener of listeners) listener();
  };
  return {
    push: vi.fn(set),
    replace: vi.fn(set),
    set,
    current: (): URLSearchParams => search,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSearchParams: () =>
      useSyncExternalStore(navigation.subscribe, navigation.current, navigation.current),
    useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  };
});

const services = vi.hoisted(() => ({
  listImports: vi.fn(),
  uploadStatement: vi.fn(),
  getImport: vi.fn(),
  saveImportSettings: vi.fn(),
  recheckImport: vi.fn(),
  listImportRows: vi.fn<(batchId: string, query: string) => Promise<ImportRowPageDto>>(),
  updateImportRow: vi.fn(),
  decideImportRow: vi.fn(),
  classifyImportRows: vi.fn(),
  importRows: vi.fn<(batchId: string, rowIds: string[]) => Promise<ImportRowsResultDto>>(),
  getImportReconciliation: vi.fn(),
  recordImportAdjustment: vi.fn(),
  finishImport: vi.fn(),
}));
vi.mock('@/services/imports.service', () => services);

const accountServices = vi.hoisted(() => ({ listAccounts: vi.fn() }));
vi.mock('@/services/accounts.service', () => accountServices);

const categoryServices = vi.hoisted(() => ({ listCategories: vi.fn() }));
vi.mock('@/services/categories.service', () => categoryServices);

// --- Data ----------------------------------------------------------------------------------------

const USER = '0193a000-0000-7000-8000-000000000001';
const AT = '2026-10-28T06:00:00.000Z';
const BATCH = '0193a000-0000-7000-8000-000000000901';
const BANK = '0193a000-0000-7000-8000-000000000201';
const GROCERIES = '0193a000-0000-7000-8000-000000000501';

const bank: AccountWithBalanceDto = {
  account: {
    id: BANK,
    userId: USER,
    name: 'HDFC Salary',
    type: 'bank',
    classification: 'asset',
    currency: 'INR',
    openingBalanceMinor: '5000000',
    openingBalanceDate: '2026-01-01',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
  },
  balance: { currentBalanceMinor: '5000000', countedTransactions: 1 },
  hasTransactions: true,
};

const groceries: CategoryDto = {
  id: GROCERIES,
  userId: USER,
  name: 'Groceries',
  kind: 'expense',
  status: 'active',
  createdAt: AT,
  updatedAt: AT,
};

const NO_COUNTS = {
  invalid: 0,
  review: 0,
  ready: 0,
  matched: 0,
  imported: 0,
  skipped: 0,
  failed: 0,
};

function detail(overrides: Partial<ImportBatchDetailDto> = {}): ImportBatchDetailDto {
  return {
    id: BATCH,
    userId: USER,
    account: { id: BANK, name: 'HDFC Salary', type: 'bank', currency: 'INR', status: 'active' },
    fileName: 'october.csv',
    format: 'csv',
    delimiter: ',',
    hasHeaderRow: true,
    currency: 'INR',
    status: 'mapping',
    columns: ['Date', 'Narration', 'Amount'],
    statement: {},
    totalRows: 3,
    counts: NO_COUNTS,
    createdAt: AT,
    updatedAt: AT,
    sampleRows: [
      ['03/04/2026', 'BigBasket order', '-1250.00'],
      ['05/04/2026', 'Salary <b>October</b>', '85000.00'],
    ],
    proposed: {
      mapping: { date: 0, description: 1, amountColumn: 2 },
      dateFormats: ['DD/MM/YYYY', 'MM/DD/YYYY'],
      decimalSeparator: '.',
    },
    ...overrides,
  };
}

const SETTINGS = {
  dateFormat: 'DD/MM/YYYY',
  decimalSeparator: '.',
  mapping: {
    date: 0,
    description: 1,
    amount: { mode: 'signed', column: 2, convention: 'negative_is_debit' },
  },
} as const;

type RowBase = Omit<Extract<ImportRowDto, { status: 'ready' }>, 'status'>;

function rowBase(id: string, rowNumber: number): RowBase {
  return {
    id,
    batchId: BATCH,
    rowNumber,
    date: '2026-04-03',
    amountMinor: '125000',
    direction: 'debit',
    description: `Row ${String(rowNumber)}`,
    warnings: [],
    duplicates: [],
    duplicateDismissed: false,
    proposal: {
      type: 'expense',
      description: `Row ${String(rowNumber)}`,
      categoryId: GROCERIES,
      tags: [],
      occurredAt: '2026-04-03T06:30:00.000Z',
      suggested: false,
    },
  };
}

function ready(id: string, rowNumber: number): ImportRowDto {
  return { ...rowBase(id, rowNumber), status: 'ready' };
}

function page(items: ImportRowDto[]): ImportRowPageDto {
  return { items, pagination: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.set('/imports');
  accountServices.listAccounts.mockResolvedValue({ accounts: [bank] });
  categoryServices.listCategories.mockResolvedValue({ categories: [groceries] });
  services.listImports.mockResolvedValue({ batches: [] });
});

// --- Tests ---------------------------------------------------------------------------------------

describe('starting an import', () => {
  it('uploads the statement into the chosen account and opens the import', async () => {
    const user = userEvent.setup();
    services.uploadStatement.mockResolvedValue(detail());
    services.getImport.mockResolvedValue(detail());
    renderWithAuth(<ImportsPage />);

    const form = await screen.findByRole('form', { name: 'Import a statement' });
    await user.click(within(form).getByRole('button', { name: 'Upload and continue' }));
    expect(within(form).getByText('Choose the account this statement belongs to.')).toBeTruthy();
    expect(within(form).getByText('Choose a CSV statement file.')).toBeTruthy();

    await user.selectOptions(within(form).getByLabelText('Account'), BANK);
    const file = new File(['Date,Narration,Amount\n'], 'october.csv', { type: 'text/csv' });
    await user.upload(within(form).getByLabelText('Statement file (CSV)'), file);
    await user.click(within(form).getByRole('button', { name: 'Upload and continue' }));

    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith(`/imports?batch=${BATCH}`);
    });
    expect(services.uploadStatement).toHaveBeenCalledWith({
      accountId: BANK,
      file,
      delimiter: undefined,
      hasHeaderRow: undefined,
    });
  });
});

describe('mapping columns', () => {
  it('asks for the date layout and sign convention instead of guessing them', async () => {
    const user = userEvent.setup();
    navigation.set(`/imports?batch=${BATCH}`);
    services.getImport.mockResolvedValue(detail());
    services.saveImportSettings.mockResolvedValue(detail({ status: 'reviewing' }));
    services.listImportRows.mockResolvedValue(page([]));
    renderWithAuth(<ImportsPage />);

    // Sample cells are shown as text, never as markup.
    expect(await screen.findByText('Salary <b>October</b>')).toBeTruthy();
    expect(
      screen.getByText(/fit more than one layout \(DD\/MM\/YYYY or MM\/DD\/YYYY\)/),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Read the rows' }));
    expect(screen.getByText('Choose how dates are written in this statement.')).toBeTruthy();
    expect(screen.getByText('Say what a negative amount means in this statement.')).toBeTruthy();
    expect(services.saveImportSettings).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Dates are written as'), 'DD/MM/YYYY');
    await user.click(screen.getByRole('radio', { name: /Money out \(a payment\)/ }));
    await user.click(screen.getByRole('button', { name: 'Read the rows' }));

    await waitFor(() => {
      expect(services.saveImportSettings).toHaveBeenCalledWith(BATCH, {
        settings: SETTINGS,
        statement: {},
      });
    });
    expect(navigation.replace).toHaveBeenCalledWith(`/imports?batch=${BATCH}&step=review`, {
      scroll: false,
    });
  });
});

describe('reviewing rows', () => {
  const reviewing = (counts: Partial<typeof NO_COUNTS>): ImportBatchDetailDto =>
    detail({ status: 'reviewing', settings: SETTINGS, counts: { ...NO_COUNTS, ...counts } });

  it('imports every ready row and reports partial success exactly', async () => {
    const user = userEvent.setup();
    navigation.set(`/imports?batch=${BATCH}&step=review`);
    services.getImport.mockResolvedValue(reviewing({ ready: 3 }));
    const rows = [ready('r1', 2), ready('r2', 3), ready('r3', 4)];
    services.listImportRows.mockImplementation((_batch, query) =>
      Promise.resolve(
        page(
          query.includes('status=ready') && services.importRows.mock.calls.length > 0 ? [] : rows,
        ),
      ),
    );
    services.importRows.mockResolvedValue({
      requested: 3,
      imported: 2,
      alreadyImported: 0,
      failed: 1,
      notReady: 0,
      results: [
        { rowId: 'r1', rowNumber: 2, outcome: 'imported', transactionId: 't1' },
        { rowId: 'r2', rowNumber: 3, outcome: 'imported', transactionId: 't2' },
        {
          rowId: 'r3',
          rowNumber: 4,
          outcome: 'failed',
          message: 'The balance would go below zero.',
        },
      ],
      batch: reviewing({ imported: 2, failed: 1 }),
    });
    renderWithAuth(<ImportsPage />);

    await user.click(await screen.findByRole('button', { name: 'Import all ready (3)' }));

    expect(
      await screen.findByText(
        /2 rows were imported\. 1 row was refused; nothing was recorded for it\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Line 4: The balance would go below zero.')).toBeTruthy();
    expect(services.importRows).toHaveBeenCalledTimes(1);
    expect(services.importRows).toHaveBeenCalledWith(BATCH, ['r1', 'r2', 'r3']);
  });

  it('links a possible duplicate to the existing transaction instead of recording it', async () => {
    const user = userEvent.setup();
    navigation.set(`/imports?batch=${BATCH}&step=review`);
    services.getImport.mockResolvedValue(reviewing({ review: 1 }));
    const duplicate: ImportRowDto = {
      ...rowBase('r1', 2),
      status: 'review',
      duplicates: [
        {
          reason: 'existing_transaction',
          dateDifferenceDays: 1,
          transaction: {
            id: 't9',
            type: 'expense',
            amountMinor: '125000',
            currency: 'INR',
            occurredAt: '2026-04-02T12:00:00.000Z',
            description: 'Groceries',
            merchant: 'BigBasket',
            status: 'active',
          },
        },
      ],
    };
    services.listImportRows.mockResolvedValue(page([duplicate]));
    services.decideImportRow.mockResolvedValue({
      ...rowBase('r1', 2),
      status: 'matched',
      transactionId: 't9',
    });
    renderWithAuth(<ImportsPage />);

    // The phone list and the desktop table are both in the document; either opens the row.
    const [review] = await screen.findAllByRole('button', { name: 'Review line 2' });
    if (review === undefined) throw new Error('The row has no review button.');
    await user.click(review);
    const sheet = await screen.findByRole('dialog');
    expect(
      within(sheet).getByText('A transaction you recorded has the same amount, 1 day apart.'),
    ).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'It is this transaction' }));

    await waitFor(() => {
      expect(services.decideImportRow).toHaveBeenCalledWith(BATCH, 'r1', {
        action: 'match',
        transactionId: 't9',
      });
    });
    expect(await within(sheet).findByText(/Nothing new was recorded/)).toBeTruthy();
    expect(services.importRows).not.toHaveBeenCalled();
  });
});

describe('reconciling the statement', () => {
  const reconciliation = (differenceMinor: string): ImportReconciliationDto => ({
    batch: detail({ status: 'reviewing', settings: SETTINGS }),
    opening: { status: 'unavailable', reason: 'no_statement_balance' },
    closing: {
      status: 'available',
      asOf: '2026-10-31T18:29:59.999Z',
      statementBalanceMinor: '5100000',
      ledgerBalanceMinor: (5_100_000n - BigInt(differenceMinor)).toString(),
      differenceMinor,
    },
    unresolvedRows: 1,
  });

  it('explains a difference and records a correction only after approval', async () => {
    const user = userEvent.setup();
    navigation.set(`/imports?batch=${BATCH}&step=reconcile`);
    services.getImport.mockResolvedValue(
      detail({
        status: 'reviewing',
        settings: SETTINGS,
        statement: { periodEnd: '2026-10-31', closingBalanceMinor: '5100000' },
      }),
    );
    services.getImportReconciliation.mockResolvedValue(reconciliation('-25000'));
    services.recordImportAdjustment.mockResolvedValue(reconciliation('0'));
    renderWithAuth(<ImportsPage />);

    expect(
      await screen.findByText(/The statement shows ₹250\.00 less than your ledger\./),
    ).toBeTruthy();
    expect(
      screen.getByText(/1 row is still waiting to be imported, matched, or skipped/),
    ).toBeTruthy();
    expect(screen.getByText(/Enter this balance from the statement to compare it\./)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Record a correction of/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(services.recordImportAdjustment).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Record the correction' }));

    await waitFor(() => {
      expect(services.recordImportAdjustment).toHaveBeenCalledWith(BATCH, {
        expectedAdjustmentMinor: '-25000',
        description: 'Statement reconciliation: october.csv',
      });
    });
  });
});
