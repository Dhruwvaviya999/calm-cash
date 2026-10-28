import {
  addDaysToIsoDate,
  calendarDateInTimeZone,
  currencyCodeSchema,
  IMPORT_ROWS_PAGE_SIZE,
  IMPORT_SAMPLE_ROWS,
  importProposalDtoSchema,
  MAX_STATEMENT_ROWS,
  MATCH_DATE_TOLERANCE_DAYS,
  parseMinorUnits,
  serializeMinorUnits,
  startOfDayInTimeZone,
  type ApiErrorDetail,
  type BalanceCheckDto,
  type ClassifyImportRowsInput,
  type CreateTransactionInput,
  type CurrencyCode,
  type ImportAdjustmentInput,
  type ImportBatchDetailDto,
  type ImportBatchDto,
  type ImportBatchListDto,
  type ImportProposalDto,
  type ImportReconciliationDto,
  type ImportRowDecisionInput,
  type ImportRowDto,
  type ImportRowListQuery,
  type ImportRowPageDto,
  type ImportRowResultDto,
  type ImportRowsInput,
  type ImportRowsResultDto,
  type ImportRowStatus,
  type ImportSettings,
  type ImportSettingsInput,
  type ImportUploadQuery,
  type UpdateImportRowInput,
} from '@calmcash/shared';

import type { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import { fromIsoDate, toIsoDate } from '../../lib/calendar-dates';
import type { TransactionsService } from '../transactions';
import { CsvParseError, readStatement } from './csv-parser';
import { movesMoney } from './duplicate-detection';
import { proposalOf, settingsOf, toBatchDto, toRowDto } from './imports.mapper';
import type { BatchRecord, ImportsRepository, ImportStore, RowRecord } from './imports.repository';
import { evaluateRows, evaluationWindow } from './row-evaluation';
import { looksLikeHeader, proposeSettings } from './statement-reader';

export interface ImportsService {
  list: (caller: Caller) => Promise<ImportBatchListDto>;
  upload: (
    caller: Caller,
    query: ImportUploadQuery,
    body: Uint8Array,
  ) => Promise<ImportBatchDetailDto>;
  get: (caller: Caller, batchId: string) => Promise<ImportBatchDetailDto>;
  saveSettings: (
    caller: Caller,
    batchId: string,
    input: ImportSettingsInput,
  ) => Promise<ImportBatchDetailDto>;
  recheck: (caller: Caller, batchId: string) => Promise<ImportBatchDetailDto>;
  rows: (caller: Caller, batchId: string, query: ImportRowListQuery) => Promise<ImportRowPageDto>;
  row: (caller: Caller, batchId: string, rowId: string) => Promise<ImportRowDto>;
  updateRow: (
    caller: Caller,
    batchId: string,
    rowId: string,
    patch: UpdateImportRowInput,
  ) => Promise<ImportRowDto>;
  decide: (
    caller: Caller,
    batchId: string,
    rowId: string,
    decision: ImportRowDecisionInput,
  ) => Promise<ImportRowDto>;
  classify: (
    caller: Caller,
    batchId: string,
    input: ClassifyImportRowsInput,
  ) => Promise<ImportBatchDto>;
  importRows: (
    caller: Caller,
    batchId: string,
    input: ImportRowsInput,
  ) => Promise<ImportRowsResultDto>;
  reconciliation: (caller: Caller, batchId: string) => Promise<ImportReconciliationDto>;
  adjust: (
    caller: Caller,
    batchId: string,
    input: ImportAdjustmentInput,
  ) => Promise<ImportReconciliationDto>;
  complete: (caller: Caller, batchId: string) => Promise<ImportBatchDto>;
  cancel: (caller: Caller, batchId: string) => Promise<ImportBatchDto>;
}

export interface ImportsServiceDependencies {
  repository: ImportsRepository;
  /** The transaction module: imported rows and balance corrections are recorded only through it. */
  transactions: Pick<TransactionsService, 'recordLinked' | 'reconcile'>;
  now: () => Date;
}

/** Statuses whose rows may still change (decisions, edits, import). */
const OPEN_ROW_STATUSES: readonly ImportRowStatus[] = ['review', 'ready', 'failed'];
/** Days around the statement date within which a manual match is accepted. */
const MANUAL_MATCH_WINDOW_DAYS = 31;

// The same answer for "does not exist" and "belongs to someone else", so IDs reveal nothing.
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That statement import does not exist or is not yours.');
const rowNotFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That statement row does not exist or is not yours.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message);
}

function assertOpen(batch: Pick<BatchRecord, 'status'>): void {
  if (batch.status === 'completed' || batch.status === 'cancelled') {
    throw conflict(`This import is ${batch.status}. Start a new import to bring in more rows.`);
  }
}

/** The settings as a JSON column value (the shape `importSettingsSchema` reads back). */
function settingsJson(settings: ImportSettings): Prisma.InputJsonObject {
  const { mapping } = settings;
  return {
    dateFormat: settings.dateFormat,
    decimalSeparator: settings.decimalSeparator,
    mapping: {
      date: mapping.date,
      description: mapping.description,
      amount:
        mapping.amount.mode === 'signed'
          ? { mode: 'signed', column: mapping.amount.column, convention: mapping.amount.convention }
          : {
              mode: 'split',
              debitColumn: mapping.amount.debitColumn,
              creditColumn: mapping.amount.creditColumn,
            },
      ...(mapping.counterparty === undefined ? {} : { counterparty: mapping.counterparty }),
      ...(mapping.reference === undefined ? {} : { reference: mapping.reference }),
    },
  };
}

/** Compared in one canonical key order, whatever order the request or the database used. */
function sameSettings(a: ImportSettings | undefined, b: ImportSettings): boolean {
  return a !== undefined && JSON.stringify(settingsJson(a)) === JSON.stringify(settingsJson(b));
}

/** The ledger transaction an approved row becomes. Transfers need the other account. */
function transactionInput(
  row: RowRecord,
  proposal: ImportProposalDto,
  accountId: string,
): CreateTransactionInput | string {
  if (row.amountMinor === null || row.direction === null) {
    return 'This row has no readable amount.';
  }
  const amountMinor = row.amountMinor.toString();
  const shared = {
    amountMinor,
    occurredAt: proposal.occurredAt,
    ...(proposal.notes === undefined ? {} : { notes: proposal.notes }),
    ...(proposal.tags.length === 0 ? {} : { tags: proposal.tags }),
  };
  if (proposal.type === 'transfer') {
    if (proposal.transferAccountId === undefined) {
      return 'Choose the other account of this transfer.';
    }
    const debit = row.direction === 'debit';
    return {
      ...shared,
      type: 'transfer',
      accountId: debit ? accountId : proposal.transferAccountId,
      transferAccountId: debit ? proposal.transferAccountId : accountId,
      description: proposal.description,
      ...(proposal.paymentMethod === undefined ? {} : { paymentMethod: proposal.paymentMethod }),
    };
  }
  if (proposal.categoryId === undefined) {
    return 'Choose a category.';
  }
  return {
    ...shared,
    type: proposal.type,
    accountId,
    categoryId: proposal.categoryId,
    description: proposal.description,
    ...(proposal.merchant === undefined ? {} : { merchant: proposal.merchant }),
    ...(proposal.paymentMethod === undefined ? {} : { paymentMethod: proposal.paymentMethod }),
  };
}

function describeFailure(error: unknown): string {
  if (error instanceof AppError) {
    const details = (error.details ?? [])
      .map((detail) => detail.message)
      .filter((message) => message !== error.message);
    return [error.message, ...details].join(' ').slice(0, 500);
  }
  return 'Something went wrong while recording this row. Nothing was recorded; try again.';
}

export function createImportsService({
  repository,
  transactions,
  now,
}: ImportsServiceDependencies): ImportsService {
  const todayFor = (caller: Caller): string => calendarDateInTimeZone(now(), caller.timeZone);

  const batchDto = async (
    batch: Awaited<ReturnType<ImportsRepository['findBatch']>>,
  ): Promise<ImportBatchDto> => {
    if (batch === null) throw notFound();
    const [counts, dates] = await Promise.all([
      repository.rowCounts([batch.id]),
      repository.rowDates([batch.id]),
    ]);
    return toBatchDto(batch, counts.get(batch.id), dates.get(batch.id));
  };

  const loadBatch = async (caller: Caller, batchId: string): Promise<ImportBatchDto> =>
    batchDto(await repository.findBatch(caller.userId, batchId));

  const get = async (caller: Caller, batchId: string): Promise<ImportBatchDetailDto> => {
    const batch = await repository.findBatch(caller.userId, batchId);
    const dto = await batchDto(batch);
    const open = dto.status === 'mapping' || dto.status === 'reviewing';
    const sample = open ? await repository.sampleRows(batchId, 200) : [];
    return {
      ...dto,
      sampleRows: sample.slice(0, IMPORT_SAMPLE_ROWS),
      proposed: proposeSettings(dto.columns, sample),
    };
  };

  /** Reads every open row again with the batch's settings and writes the results. */
  const evaluate = async (
    caller: Caller,
    store: ImportStore,
    batch: Pick<BatchRecord, 'id' | 'accountId' | 'currency'>,
    settings: ImportSettings,
    keepProposals: boolean,
  ): Promise<void> => {
    const currency: CurrencyCode = currencyCodeSchema.parse(batch.currency);
    const rows = await store.rows(batch.id);
    const window = evaluationWindow(rows, settings, currency);
    const from =
      window === undefined ? undefined : addDaysToIsoDate(window.from, -MATCH_DATE_TOLERANCE_DAYS);
    const to =
      window === undefined ? undefined : addDaysToIsoDate(window.to, MATCH_DATE_TOLERANCE_DAYS);
    const [priorImports, ledger, linkedElsewhere, suggestions] =
      from === undefined || to === undefined
        ? [[], [], new Set<string>(), []]
        : await Promise.all([
            repository.priorImports(
              caller.userId,
              batch.accountId,
              batch.id,
              fromIsoDate(from),
              fromIsoDate(to),
            ),
            repository.ledger(
              caller.userId,
              batch.accountId,
              currency,
              startOfDayInTimeZone(addDaysToIsoDate(from, -1), caller.timeZone),
              startOfDayInTimeZone(addDaysToIsoDate(to, 2), caller.timeZone),
            ),
            repository.linkedTransactionIds(caller.userId, batch.accountId, batch.id),
            repository.suggestions(caller.userId, batch.accountId),
          ]);
    await store.writeEvaluations(
      batch.id,
      evaluateRows({
        accountId: batch.accountId,
        currency,
        timeZone: caller.timeZone,
        settings,
        rows,
        priorImports,
        ledger,
        linkedElsewhere,
        suggestions,
        keepProposals,
      }),
    );
  };

  const lockOpenBatch = async (
    store: ImportStore,
    caller: Caller,
    batchId: string,
  ): Promise<BatchRecord> => {
    const batch = await store.lockBatch(caller.userId, batchId);
    if (batch === null) throw notFound();
    assertOpen(batch);
    return batch;
  };

  const lockOpenRow = async (
    store: ImportStore,
    caller: Caller,
    batchId: string,
    rowId: string,
  ): Promise<RowRecord> => {
    const row = await store.lockRow(caller.userId, batchId, rowId);
    if (row === null) throw rowNotFound();
    return row;
  };

  const loadRow = async (caller: Caller, batchId: string, rowId: string): Promise<ImportRowDto> => {
    const row = await repository.findRow(caller.userId, batchId, rowId);
    if (row === null) throw rowNotFound();
    return toRowDto(row);
  };

  /** Checks that a transaction may be linked to the row as "the same money movement". */
  const assertMatchable = async (
    caller: Caller,
    batch: BatchRecord,
    row: RowRecord,
    transactionId: string,
    linkedInBatch: ReadonlySet<string>,
  ): Promise<void> => {
    const transaction = await repository.findTransaction(caller.userId, transactionId);
    const path = 'body.transactionId';
    if (transaction === null) {
      throw invalid([{ path, message: 'Choose one of your transactions.' }]);
    }
    if (row.amountMinor === null || row.direction === null || row.occurredOn === null) {
      throw conflict('This row cannot be read, so it cannot be matched.');
    }
    if (transaction.voidedAt !== null) {
      throw invalid([
        { path, message: 'That transaction is voided. Restore it or import the row instead.' },
      ]);
    }
    if (
      transaction.currency !== batch.currency ||
      transaction.amountMinor !== row.amountMinor ||
      !movesMoney(transaction, batch.accountId, row.direction)
    ) {
      throw invalid([
        {
          path,
          message:
            'That transaction is a different amount or moves money the other way, so it is not this row.',
        },
      ]);
    }
    const days = Math.abs(
      (Date.parse(`${calendarDateInTimeZone(transaction.occurredAt, caller.timeZone)}T12:00:00Z`) -
        Date.parse(`${toIsoDate(row.occurredOn)}T12:00:00Z`)) /
        86_400_000,
    );
    if (days > MANUAL_MATCH_WINDOW_DAYS) {
      throw invalid([
        {
          path,
          message: `That transaction is more than ${MANUAL_MATCH_WINDOW_DAYS} days away from this row.`,
        },
      ]);
    }
    const elsewhere = await repository.linkedTransactionIds(
      caller.userId,
      batch.accountId,
      batch.id,
    );
    if (elsewhere.has(transactionId) || linkedInBatch.has(transactionId)) {
      throw conflict('That transaction is already linked to another statement row.');
    }
  };

  /** Marks a row failed after a refused import, unless another request changed it meanwhile. */
  const recordFailure = async (
    caller: Caller,
    batchId: string,
    rowId: string,
    message: string,
  ): Promise<void> => {
    await repository.inBatchWrite(async (store) => {
      const row = await store.lockRow(caller.userId, batchId, rowId);
      if (row !== null && (row.status === 'ready' || row.status === 'failed')) {
        await store.updateRow(row.id, { status: 'failed', error: message });
      }
    });
  };

  const balanceCheck = async (
    caller: Caller,
    batch: NonNullable<Awaited<ReturnType<ImportsRepository['findBatch']>>>,
    which: 'opening' | 'closing',
  ): Promise<BalanceCheckDto> => {
    const statementBalance =
      which === 'opening' ? batch.openingBalanceMinor : batch.closingBalanceMinor;
    const date = which === 'opening' ? batch.periodStart : batch.periodEnd;
    if (statementBalance === null) return { status: 'unavailable', reason: 'no_statement_balance' };
    if (date === null) return { status: 'unavailable', reason: 'no_statement_date' };
    const day = toIsoDate(date);
    if (day > todayFor(caller)) return { status: 'unavailable', reason: 'in_future' };
    // Opening: just before the first day starts. Closing: the last moment of the last day.
    const asOf =
      which === 'opening'
        ? new Date(startOfDayInTimeZone(day, caller.timeZone).getTime() - 1)
        : new Date(startOfDayInTimeZone(addDaysToIsoDate(day, 1), caller.timeZone).getTime() - 1);
    const { balanceMinor, countsFrom } = await repository.ledgerBalance(
      caller.userId,
      batch.account,
      asOf,
    );
    let ledgerBalance = balanceMinor;
    if (asOf < countsFrom) {
      // The day the account starts being tracked opens with its opening balance; earlier is unknown.
      if (which === 'opening' && asOf.getTime() + 1 === countsFrom.getTime()) {
        ledgerBalance = batch.account.openingBalanceMinor;
      } else {
        return { status: 'unavailable', reason: 'before_tracking' };
      }
    }
    return {
      status: 'available',
      asOf: asOf.toISOString(),
      statementBalanceMinor: serializeMinorUnits(statementBalance),
      ledgerBalanceMinor: serializeMinorUnits(ledgerBalance),
      differenceMinor: (statementBalance - ledgerBalance).toString(),
    };
  };

  const reconciliation = async (
    caller: Caller,
    batchId: string,
  ): Promise<ImportReconciliationDto> => {
    const batch = await repository.findBatch(caller.userId, batchId);
    if (batch === null) throw notFound();
    const dto = await batchDto(batch);
    return {
      batch: dto,
      opening: await balanceCheck(caller, batch, 'opening'),
      closing: await balanceCheck(caller, batch, 'closing'),
      unresolvedRows: dto.counts.review + dto.counts.ready + dto.counts.failed,
    };
  };

  return {
    list: async (caller) => {
      const batches = await repository.listBatches(caller.userId);
      const ids = batches.map((batch) => batch.id);
      const [counts, dates] = await Promise.all([
        repository.rowCounts(ids),
        repository.rowDates(ids),
      ]);
      return {
        batches: batches.map((batch) =>
          toBatchDto(batch, counts.get(batch.id), dates.get(batch.id)),
        ),
      };
    },

    upload: async (caller, query, body) => {
      const account = await repository.findAccount(caller.userId, query.accountId);
      if (account === null) {
        throw invalid([{ path: 'query.accountId', message: 'Choose one of your accounts.' }]);
      }
      if (account.archivedAt !== null) {
        throw conflict(`${account.name} is archived. Restore it before importing into it.`);
      }
      if (body.length === 0) {
        throw invalid([{ path: 'body', message: 'Choose a statement file.' }]);
      }
      let statement: ReturnType<typeof readStatement>;
      try {
        statement = readStatement(body, query.delimiter);
      } catch (error: unknown) {
        if (error instanceof CsvParseError) {
          throw invalid([{ path: 'body', message: error.message }]);
        }
        throw error;
      }
      const [first = [], second] = statement.records;
      const hasHeaderRow = query.hasHeaderRow ?? looksLikeHeader(first, second);
      const width = Math.max(...statement.records.map((record) => record.length));
      const columns = Array.from({ length: width }, (_, index) => {
        const name = hasHeaderRow ? (first[index] ?? '').trim().replace(/\s+/g, ' ') : '';
        return name === '' ? `Column ${String(index + 1)}` : name;
      });
      const dataRows = hasHeaderRow ? statement.records.slice(1) : statement.records;
      if (dataRows.length === 0) {
        throw invalid([{ path: 'body', message: 'The file has no rows below its header.' }]);
      }
      if (dataRows.length > MAX_STATEMENT_ROWS) {
        throw invalid([
          {
            path: 'body',
            message: `The statement has more than ${String(MAX_STATEMENT_ROWS)} rows. Split it into smaller periods.`,
          },
        ]);
      }
      const batchId = await repository.createBatch(
        caller.userId,
        {
          accountId: account.id,
          fileName: query.fileName,
          delimiter: statement.delimiter,
          hasHeaderRow,
          currency: account.currency,
          columns,
          createdAt: now(),
        },
        dataRows,
        hasHeaderRow ? 2 : 1,
      );
      return get(caller, batchId);
    },

    get,

    saveSettings: async (caller, batchId, { settings, statement }) => {
      await repository.inBatchWrite(async (store) => {
        const batch = await lockOpenBatch(store, caller, batchId);
        const current = settingsOf(batch);
        const unchanged = sameSettings(current, settings);
        const { mapping } = settings;
        const used: { field: string; column: number | undefined }[] = [
          { field: 'date', column: mapping.date },
          { field: 'description', column: mapping.description },
          { field: 'counterparty', column: mapping.counterparty },
          { field: 'reference', column: mapping.reference },
          ...(mapping.amount.mode === 'signed'
            ? [{ field: 'amount', column: mapping.amount.column }]
            : [
                { field: 'amount', column: mapping.amount.debitColumn },
                { field: 'amount', column: mapping.amount.creditColumn },
              ]),
        ];
        const missing = used.filter(
          ({ column }) => column !== undefined && column >= batch.columns.length,
        );
        if (missing.length > 0) {
          throw invalid(
            missing.map(({ field }) => ({
              path: `body.settings.mapping.${field}`,
              message: 'That column does not exist in this file.',
            })),
          );
        }
        if (!unchanged) {
          const rows = await store.rows(batch.id);
          if (rows.some((row) => row.status === 'matched' || row.status === 'imported')) {
            throw conflict(
              'Rows of this statement are already imported or matched, so its columns stay as they are. Start a new import to read the file differently.',
            );
          }
        }
        await store.updateBatch(batch.id, {
          status: 'reviewing',
          settings: settingsJson(settings),
          ...(statement === undefined
            ? {}
            : {
                periodStart:
                  statement.periodStart === undefined ? null : fromIsoDate(statement.periodStart),
                periodEnd:
                  statement.periodEnd === undefined ? null : fromIsoDate(statement.periodEnd),
                openingBalanceMinor:
                  statement.openingBalanceMinor === undefined
                    ? null
                    : parseMinorUnits(statement.openingBalanceMinor),
                closingBalanceMinor:
                  statement.closingBalanceMinor === undefined
                    ? null
                    : parseMinorUnits(statement.closingBalanceMinor),
              }),
        });
        await evaluate(caller, store, batch, settings, unchanged);
      });
      return get(caller, batchId);
    },

    recheck: async (caller, batchId) => {
      await repository.inBatchWrite(async (store) => {
        const batch = await lockOpenBatch(store, caller, batchId);
        const settings = settingsOf(batch);
        if (settings === undefined) {
          throw conflict('Confirm how the columns are read first.');
        }
        await evaluate(caller, store, batch, settings, true);
      });
      return get(caller, batchId);
    },

    rows: async (caller, batchId, { status, page }) => {
      const batch = await repository.findBatch(caller.userId, batchId);
      if (batch === null) throw notFound();
      const statuses: readonly ImportRowStatus[] | undefined =
        status === undefined
          ? undefined
          : status === 'attention'
            ? ['invalid', 'review', 'failed']
            : status === 'open'
              ? OPEN_ROW_STATUSES
              : [status];
      const { rows, total } = await repository.pageRows(batchId, statuses, page);
      return {
        items: rows.map(toRowDto),
        pagination: {
          page,
          pageSize: IMPORT_ROWS_PAGE_SIZE,
          totalItems: total,
          totalPages: Math.ceil(total / IMPORT_ROWS_PAGE_SIZE),
        },
      };
    },

    row: loadRow,

    updateRow: async (caller, batchId, rowId, patch) => {
      await repository.inBatchWrite(async (store) => {
        const batch = await lockOpenBatch(store, caller, batchId);
        const row = await lockOpenRow(store, caller, batchId, rowId);
        const current = proposalOf(row);
        if (
          !OPEN_ROW_STATUSES.includes(row.status) ||
          current === undefined ||
          row.direction === null
        ) {
          throw conflict('Only rows still waiting to be imported can be changed.');
        }
        const type = patch.type ?? current.type;
        if (type !== 'transfer' && (type === 'expense') !== (row.direction === 'debit')) {
          throw invalid([
            {
              path: 'body.type',
              message:
                row.direction === 'debit'
                  ? 'This is money out of the account: choose an expense or a transfer.'
                  : 'This is money into the account: choose income or a transfer.',
            },
          ]);
        }
        const pick = <K extends keyof ImportProposalDto>(
          key: K,
          value: ImportProposalDto[K] | null | undefined,
        ): Partial<ImportProposalDto> =>
          value === null || value === undefined ? {} : { [key]: value };
        const transferAccountId =
          patch.transferAccountId === undefined
            ? current.transferAccountId
            : patch.transferAccountId;
        const categoryId = patch.categoryId === undefined ? current.categoryId : patch.categoryId;
        const merchant = patch.merchant === undefined ? current.merchant : patch.merchant;
        const next = {
          type,
          description: patch.description ?? current.description,
          ...(type === 'transfer'
            ? pick('transferAccountId', transferAccountId)
            : pick('categoryId', categoryId)),
          ...(type === 'transfer' ? {} : pick('merchant', merchant)),
          ...pick(
            'paymentMethod',
            patch.paymentMethod === undefined ? current.paymentMethod : patch.paymentMethod,
          ),
          ...pick('notes', patch.notes === undefined ? current.notes : patch.notes),
          tags: patch.tags ?? current.tags,
          occurredAt: patch.occurredAt ?? current.occurredAt,
          suggested:
            current.suggested && patch.categoryId === undefined && patch.merchant === undefined,
        };
        const parsed = importProposalDtoSchema.safeParse(next);
        if (!parsed.success) {
          throw invalid(
            parsed.error.issues.map((issue) => ({
              path: ['body', ...issue.path.map(String)].join('.'),
              message: issue.message,
            })),
          );
        }
        const proposal = parsed.data;
        if (proposal.type === 'transfer' && proposal.transferAccountId !== undefined) {
          const other = await repository.findAccount(caller.userId, proposal.transferAccountId);
          if (other === null || other.id === batch.accountId) {
            throw invalid([
              { path: 'body.transferAccountId', message: 'Choose another of your accounts.' },
            ]);
          }
          if (other.archivedAt !== null || other.currency !== batch.currency) {
            throw invalid([
              {
                path: 'body.transferAccountId',
                message: `Choose an active account in ${batch.currency}.`,
              },
            ]);
          }
        }
        if (
          proposal.type !== 'transfer' &&
          proposal.categoryId !== undefined &&
          patch.categoryId !== undefined
        ) {
          const category = await repository.findCategory(caller.userId, proposal.categoryId);
          if (category?.archivedAt !== null || category.kind !== proposal.type) {
            throw invalid([
              {
                path: 'body.categoryId',
                message: `Choose an active ${proposal.type === 'income' ? 'income' : 'spending'} category.`,
              },
            ]);
          }
        }
        await store.updateRow(row.id, {
          proposal: { ...proposal },
          ...(row.status === 'failed' ? { status: 'ready', error: null } : {}),
        });
      });
      return loadRow(caller, batchId, rowId);
    },

    decide: async (caller, batchId, rowId, decision) => {
      await repository.inBatchWrite(async (store) => {
        const batch = await lockOpenBatch(store, caller, batchId);
        const row = await lockOpenRow(store, caller, batchId, rowId);
        switch (decision.action) {
          case 'match': {
            if (!OPEN_ROW_STATUSES.includes(row.status)) {
              throw conflict('Only rows still waiting to be imported can be matched.');
            }
            const rows = await store.rows(batch.id);
            const linked = new Set(
              rows.flatMap((entry) =>
                entry.id === row.id
                  ? []
                  : [entry.matchedTransactionId, entry.importedTransactionId].filter(
                      (id) => id !== null,
                    ),
              ),
            );
            await assertMatchable(caller, batch, row, decision.transactionId, linked);
            await store.updateRow(row.id, {
              status: 'matched',
              matchedTransactionId: decision.transactionId,
              error: null,
            });
            return;
          }
          case 'not_duplicate':
            if (row.status !== 'review') {
              throw conflict('Only rows flagged as possible duplicates need this decision.');
            }
            await store.updateRow(row.id, { status: 'ready', duplicateDismissed: true });
            return;
          case 'skip':
            if (row.status === 'imported' || row.status === 'matched' || row.status === 'skipped') {
              if (row.status === 'skipped') return; // Already skipped.
              throw conflict('This row is already imported or matched.');
            }
            await store.updateRow(row.id, { status: 'skipped', error: null });
            return;
          case 'restore': {
            if (row.status !== 'skipped' && row.status !== 'matched') return; // Nothing to undo.
            const settings = settingsOf(batch);
            await store.updateRow(row.id, {
              status: 'ready',
              matchedTransactionId: null,
              duplicateDismissed: false,
            });
            if (settings !== undefined) {
              await evaluate(caller, store, batch, settings, true);
            }
            return;
          }
        }
      });
      return loadRow(caller, batchId, rowId);
    },

    classify: async (caller, batchId, { rowIds, categoryId }) => {
      const category = await repository.findCategory(caller.userId, categoryId);
      if (category?.archivedAt !== null) {
        throw invalid([
          { path: 'body.categoryId', message: 'Choose one of your active categories.' },
        ]);
      }
      await repository.inBatchWrite(async (store) => {
        await lockOpenBatch(store, caller, batchId);
        for (const rowId of rowIds) {
          const row = await store.lockRow(caller.userId, batchId, rowId);
          const proposal = row === null ? undefined : proposalOf(row);
          if (
            row !== null &&
            proposal !== undefined &&
            OPEN_ROW_STATUSES.includes(row.status) &&
            proposal.type === category.kind
          ) {
            await store.updateRow(row.id, {
              proposal: { ...proposal, categoryId, suggested: false },
            });
          }
        }
      });
      return loadBatch(caller, batchId);
    },

    importRows: async (caller, batchId, { rowIds }) => {
      const batch = await repository.findBatch(caller.userId, batchId);
      if (batch === null) throw notFound();
      if (batch.status !== 'reviewing') {
        throw conflict(
          batch.status === 'mapping'
            ? 'Confirm how the columns are read first.'
            : `This import is ${batch.status}.`,
        );
      }
      const rows = await repository.findRows(caller.userId, batchId, rowIds);
      const found = new Set(rows.map((row) => row.id));
      const missing = rowIds.flatMap((id, index) =>
        found.has(id) ? [] : [{ path: `body.rowIds.${String(index)}`, message: 'Not found.' }],
      );
      if (missing.length > 0) {
        throw new AppError(
          404,
          'NOT_FOUND',
          'Some selected rows do not exist or are not yours. Nothing was imported.',
          { details: missing },
        );
      }
      // Money in before money out, then by date: each row is checked against the balance as it is
      // when it is recorded, so this order avoids refusing a payment funded by a later-listed credit.
      const ordered = [...rows].sort(
        (a, b) =>
          (a.direction === 'credit' ? 0 : 1) - (b.direction === 'credit' ? 0 : 1) ||
          (a.occurredOn?.getTime() ?? 0) - (b.occurredOn?.getTime() ?? 0) ||
          a.rowNumber - b.rowNumber,
      );
      const results: ImportRowResultDto[] = [];
      for (const row of ordered) {
        const base = { rowId: row.id, rowNumber: row.rowNumber };
        if (row.status === 'imported' && row.importedTransactionId !== null) {
          results.push({
            ...base,
            outcome: 'already_imported',
            transactionId: row.importedTransactionId,
          });
          continue;
        }
        if (row.status !== 'ready' && row.status !== 'failed') {
          const reasons: Partial<Record<ImportRowStatus, string>> = {
            invalid: 'This row cannot be read with the current settings.',
            review: 'Decide whether this is a duplicate first.',
            matched: 'This row is matched to an existing transaction.',
            skipped: 'This row was skipped.',
          };
          results.push({
            ...base,
            outcome: 'not_ready',
            message: reasons[row.status] ?? 'Not ready.',
          });
          continue;
        }
        const proposal = proposalOf(row);
        const input =
          proposal === undefined
            ? 'This row has nothing to record.'
            : transactionInput(row, proposal, batch.accountId);
        if (typeof input === 'string') {
          results.push({ ...base, outcome: 'not_ready', message: input });
          continue;
        }
        try {
          const outcome = await transactions.recordLinked(
            caller,
            input,
            {
              claim: async (db) => {
                const store = repository.storeFor(db);
                const locked = await store.lockRow(caller.userId, batchId, row.id);
                if (locked === null) throw rowNotFound();
                if (locked.status === 'imported' && locked.importedTransactionId !== null) {
                  return locked.importedTransactionId; // Imported by an earlier request: never twice.
                }
                if (locked.status !== 'ready' && locked.status !== 'failed') {
                  throw conflict('This row changed meanwhile. Review it and try again.');
                }
                if (locked.updatedAt.getTime() !== row.updatedAt.getTime()) {
                  throw conflict('This row changed meanwhile. Review it and try again.');
                }
                return undefined;
              },
              commit: async (db, transactionId) => {
                await repository.storeFor(db).updateRow(row.id, {
                  status: 'imported',
                  importedTransactionId: transactionId,
                  error: null,
                });
              },
            },
            // The row's ID doubles as the transaction's idempotency key: one row, one transaction.
            { idempotencyKey: row.id },
          );
          results.push({
            ...base,
            outcome: outcome.replayed ? 'already_imported' : 'imported',
            transactionId: outcome.item.transaction.id,
          });
        } catch (error: unknown) {
          const message = describeFailure(error);
          await recordFailure(caller, batchId, row.id, message);
          results.push({ ...base, outcome: 'failed', message });
        }
      }
      const byInput = new Map(rowIds.map((id, index) => [id, index]));
      results.sort((a, b) => (byInput.get(a.rowId) ?? 0) - (byInput.get(b.rowId) ?? 0));
      const count = (outcome: ImportRowResultDto['outcome']): number =>
        results.filter((result) => result.outcome === outcome).length;
      return {
        requested: rowIds.length,
        imported: count('imported'),
        alreadyImported: count('already_imported'),
        failed: count('failed'),
        notReady: count('not_ready'),
        results,
        batch: await loadBatch(caller, batchId),
      };
    },

    reconciliation,

    adjust: async (caller, batchId, input) => {
      const batch = await repository.findBatch(caller.userId, batchId);
      if (batch === null) throw notFound();
      assertOpen(batch);
      const closing = await balanceCheck(caller, batch, 'closing');
      if (closing.status !== 'available') {
        throw conflict('Enter the statement end date and closing balance to compare them first.');
      }
      if (closing.differenceMinor === '0') {
        throw conflict('The ledger already matches the statement, so nothing was recorded.');
      }
      // The existing reconciliation records the adjustment, with its own preview check: if the
      // balance moved since the person reviewed it, nothing is recorded. The batch ID is the
      // idempotency key, so repeating the request cannot correct the balance twice.
      const outcome = await transactions.reconcile(
        caller,
        {
          accountId: batch.accountId,
          observedBalanceMinor: closing.statementBalanceMinor,
          asOf: closing.asOf,
          description: input.description,
          expectedAdjustmentMinor: input.expectedAdjustmentMinor,
        },
        batch.id,
      );
      await repository.inBatchWrite(async (store) => {
        await lockOpenBatch(store, caller, batchId);
        await store.updateBatch(batchId, {
          adjustmentTransactionId: outcome.item.transaction.id,
          reconciledAt: now(),
          reconciliationDifferenceMinor: 0n,
        });
      });
      return reconciliation(caller, batchId);
    },

    complete: async (caller, batchId) => {
      const batch = await repository.findBatch(caller.userId, batchId);
      if (batch === null) throw notFound();
      if (batch.status === 'completed') return loadBatch(caller, batchId);
      if (batch.status !== 'reviewing') {
        throw conflict(
          batch.status === 'mapping'
            ? 'Confirm how the columns are read first.'
            : 'This import is cancelled.',
        );
      }
      const closing = await balanceCheck(caller, batch, 'closing');
      await repository.inBatchWrite(async (store) => {
        const locked = await lockOpenBatch(store, caller, batchId);
        await store.updateBatch(locked.id, {
          status: 'completed',
          completedAt: now(),
          // What was checked, for the record: the closing difference when it could be compared.
          ...(closing.status === 'available'
            ? {
                reconciledAt: now(),
                reconciliationDifferenceMinor: BigInt(closing.differenceMinor),
              }
            : {}),
        });
        // The raw statement cells are not needed once the import is finished.
        await store.clearCells(locked.id);
      });
      return loadBatch(caller, batchId);
    },

    cancel: async (caller, batchId) => {
      await repository.inBatchWrite(async (store) => {
        const batch = await store.lockBatch(caller.userId, batchId);
        if (batch === null) throw notFound();
        if (batch.status === 'cancelled') return;
        if (batch.status === 'completed') {
          throw conflict(
            'This import is completed. Its imported transactions stay in your ledger.',
          );
        }
        // Transactions already imported are ordinary ledger rows and stay; only staging ends.
        await store.updateBatch(batch.id, { status: 'cancelled', cancelledAt: now() });
        await store.clearCells(batch.id);
      });
      return loadBatch(caller, batchId);
    },
  };
}
