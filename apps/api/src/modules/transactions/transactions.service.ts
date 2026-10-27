import {
  categoryKindForTransactionType,
  currencyCodeSchema,
  MAX_TAGS_PER_TRANSACTION,
  normalizeTags,
  serializeMinorUnits,
  type ApiErrorDetail,
  type BulkTransactionInput,
  type BulkTransactionResultDto,
  type CreateBalanceAdjustmentInput,
  type CreateReconciliationInput,
  type CreateTransactionInput,
  type CurrencyCashFlowDto,
  type ReconciliationPreviewDto,
  type ReconciliationPreviewInput,
  type TransactionFilterQuery,
  type TransactionListItemDto,
  type TransactionListQuery,
  type TransactionPageDto,
  type TransactionSummaryDto,
  type UpdateTransactionInput,
  type VoidTransactionInput,
} from '@calmcash/shared';

import { AppError } from '../../lib/app-error';
import type { Caller } from '../../lib/auth-boundary';
import {
  describeAccountBalance,
  NO_MOVEMENTS,
  signedAdjustment,
  withAdjustment,
} from '../accounts';
import {
  accountsOf,
  accountsOfInput,
  assertAccountsWritable,
  assertBalanceRules,
  evaluateReconciliation,
  mergeTransactionUpdate,
  planTransactionWrite,
} from './transaction-rules';
import { toTransactionListItemDto } from './transactions.mapper';
import {
  IdempotencyKeyTakenError,
  type Ledger,
  type LinkedWriteClient,
  type TransactionRecord,
  type TransactionsRepository,
  type TransactionWrite,
} from './transactions.repository';

/** A recorded transaction, and whether it was recorded by an earlier request with the same key. */
export interface WriteOutcome {
  item: TransactionListItemDto;
  replayed: boolean;
}

/**
 * Another module's rows that must change together with a new transaction (for example the
 * scheduled occurrence it settles). Both callbacks run inside the write's database transaction;
 * anything they throw rolls the transaction back with everything else.
 */
export interface LinkedRecording {
  /**
   * Runs first, before any account is locked: lock and check the linked rows here. Returns the ID
   * of a transaction the link already recorded to replay it instead of writing a new one.
   */
  claim: (db: LinkedWriteClient) => Promise<string | undefined>;
  /** Runs after the transaction is written and every balance rule held. */
  commit: (db: LinkedWriteClient, transactionId: string) => Promise<void>;
}

export interface TransactionsService {
  list: (caller: Caller, query: TransactionListQuery) => Promise<TransactionPageDto>;
  summary: (caller: Caller, filters: TransactionFilterQuery) => Promise<TransactionSummaryDto>;
  get: (caller: Caller, transactionId: string) => Promise<TransactionListItemDto>;
  create: (
    caller: Caller,
    input: CreateTransactionInput,
    idempotencyKey: string | undefined,
  ) => Promise<WriteOutcome>;
  update: (
    caller: Caller,
    transactionId: string,
    input: UpdateTransactionInput,
  ) => Promise<TransactionListItemDto>;
  void: (
    caller: Caller,
    transactionId: string,
    input: VoidTransactionInput,
  ) => Promise<TransactionListItemDto>;
  restore: (caller: Caller, transactionId: string) => Promise<TransactionListItemDto>;
  bulk: (caller: Caller, input: BulkTransactionInput) => Promise<BulkTransactionResultDto>;
  previewReconciliation: (
    caller: Caller,
    input: ReconciliationPreviewInput,
  ) => Promise<ReconciliationPreviewDto>;
  reconcile: (
    caller: Caller,
    input: CreateReconciliationInput,
    idempotencyKey: string | undefined,
  ) => Promise<WriteOutcome>;
  /**
   * Records income or an expense exactly like `create` — same locks, ownership, archive, date,
   * category, and balance rules — atomically with another module's linked rows.
   */
  recordLinked: (
    caller: Caller,
    input: CreateTransactionInput,
    link: LinkedRecording,
  ) => Promise<WriteOutcome>;
}

export interface TransactionsServiceDependencies {
  repository: TransactionsRepository;
  now: () => Date;
}

// The same answer for "does not exist" and "belongs to someone else", so IDs reveal nothing.
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'That transaction does not exist or is not yours.');

function invalid(details: ApiErrorDetail[]): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { details });
}

const keyReused = (): AppError =>
  new AppError(
    409,
    'CONFLICT',
    'This request was already used to record a different transaction. Refresh and try again.',
  );

/** A retry must describe the same money movement as the request that used the key first. */
function assertSameTransaction(existing: TransactionRecord, input: CreateTransactionInput): void {
  const same =
    existing.type === input.type &&
    existing.accountId === input.accountId &&
    existing.amountMinor.toString() === input.amountMinor &&
    existing.transferAccountId === (input.type === 'transfer' ? input.transferAccountId : null) &&
    existing.adjustmentDirection ===
      (input.type === 'balance_adjustment' ? input.adjustmentDirection : null);
  if (!same) {
    throw keyReused();
  }
}

function assertSameReconciliation(
  existing: TransactionRecord,
  input: CreateReconciliationInput,
): void {
  const direction = existing.adjustmentDirection;
  const same =
    existing.type === 'balance_adjustment' &&
    direction !== null &&
    existing.accountId === input.accountId &&
    signedAdjustment({ direction, amountMinor: existing.amountMinor }).toString() ===
      input.expectedAdjustmentMinor;
  if (!same) {
    throw keyReused();
  }
}

export function createTransactionsService({
  repository,
  now,
}: TransactionsServiceDependencies): TransactionsService {
  const load = async (caller: Caller, transactionId: string): Promise<TransactionListItemDto> => {
    const row = await repository.findWithRefs(caller.userId, transactionId);
    if (row === null) {
      throw notFound();
    }
    return toTransactionListItemDto(row);
  };

  /**
   * The heart of every balance-changing write, run inside a ledger: lock every account the old and
   * new versions touch (ID order), check the rules against the locked state, read the balances,
   * write, read them again, and refuse the result if a balance rule breaks. Anything thrown rolls
   * the whole write back, so no account ever sees half of it.
   */
  const writeLocked = async (
    ledger: Ledger,
    caller: Caller,
    input: CreateTransactionInput,
    at: Date,
    existing: TransactionRecord | undefined,
    persist: (write: TransactionWrite) => Promise<string>,
  ): Promise<string> => {
    const accounts = await ledger.lockAccounts(caller.userId, [
      ...accountsOfInput(input),
      ...(existing === undefined ? [] : accountsOf(existing)),
    ]);
    if (existing !== undefined) {
      assertAccountsWritable(accounts, accountsOf(existing));
    }
    const category =
      input.type === 'income' || input.type === 'expense'
        ? await ledger.findCategory(caller.userId, input.categoryId)
        : null;
    const write = planTransactionWrite(input, {
      accounts,
      category,
      ...(existing === undefined ? {} : { existing }),
      timeZone: caller.timeZone,
      now: at,
    });

    const affected = { accountIds: [...accounts.keys()] };
    const before = await ledger.movementTotals(caller.userId, affected);
    const transactionId = await persist(write);
    const after = await ledger.movementTotals(caller.userId, affected);
    assertBalanceRules(accounts, before, after, 'body.amountMinor');
    return transactionId;
  };

  /** Voids or restores transactions as one change, with the same locks and balance checks. */
  const changeVoidState = async (
    ledger: Ledger,
    caller: Caller,
    records: readonly TransactionRecord[],
    voided: { at: Date; reason: string | null } | null,
  ): Promise<number> => {
    const accountIds = records.flatMap(accountsOf);
    const accounts = await ledger.lockAccounts(caller.userId, accountIds);
    assertAccountsWritable(accounts, accountIds);
    const affected = { accountIds: [...accounts.keys()] };
    const before = await ledger.movementTotals(caller.userId, affected);
    const changed = await ledger.setVoided(
      records.map((record) => record.id),
      voided,
    );
    const after = await ledger.movementTotals(caller.userId, affected);
    assertBalanceRules(accounts, before, after, undefined);
    return changed;
  };

  const lockOne = async (
    ledger: Ledger,
    caller: Caller,
    transactionId: string,
  ): Promise<TransactionRecord> => {
    const [record] = await ledger.lockTransactions(caller.userId, [transactionId]);
    if (record === undefined) {
      throw notFound();
    }
    return record;
  };

  /** Runs an idempotent insert; a lost race on the key resolves to the winner's transaction. */
  const recordOnce = async (
    caller: Caller,
    idempotencyKey: string | undefined,
    sameRequest: (existing: TransactionRecord) => void,
    work: (ledger: Ledger) => Promise<{ id: string; replayed: boolean }>,
  ): Promise<WriteOutcome> => {
    try {
      const { id, replayed } = await repository.inLedger(work);
      return { item: await load(caller, id), replayed };
    } catch (error: unknown) {
      if (error instanceof IdempotencyKeyTakenError && idempotencyKey !== undefined) {
        const existing = await repository.findByIdempotencyKey(caller.userId, idempotencyKey);
        if (existing !== null) {
          sameRequest(existing);
          return { item: await load(caller, existing.id), replayed: true };
        }
      }
      throw error;
    }
  };

  const replayIfKnown = async (
    ledger: Ledger,
    caller: Caller,
    idempotencyKey: string | undefined,
    sameRequest: (existing: TransactionRecord) => void,
  ): Promise<{ id: string; replayed: true } | undefined> => {
    if (idempotencyKey === undefined) {
      return undefined;
    }
    const existing = await ledger.findByIdempotencyKey(caller.userId, idempotencyKey);
    if (existing === null) {
      return undefined;
    }
    sameRequest(existing);
    return { id: existing.id, replayed: true };
  };

  return {
    list: async (caller, { page, pageSize, sort, ...filters }) => {
      const { rows, total } = await repository.findPage(caller.userId, {
        filters,
        timeZone: caller.timeZone,
        sort,
        page,
        pageSize,
      });
      return {
        items: rows.map(toTransactionListItemDto),
        pagination: {
          page,
          pageSize,
          totalItems: total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    },

    summary: async (caller, filters) => {
      const groups = await repository.cashFlow(caller.userId, filters, caller.timeZone);
      const byCurrency = new Map<string, CurrencyCashFlowDto>();
      const totals = new Map<string, { income: bigint; expense: bigint }>();
      for (const group of groups) {
        const currency = currencyCodeSchema.parse(group.currency);
        const entry = byCurrency.get(currency) ?? {
          currency,
          incomeMinor: '0',
          expenseMinor: '0',
          netMinor: '0',
          incomeCount: 0,
          expenseCount: 0,
        };
        const sums = totals.get(currency) ?? { income: 0n, expense: 0n };
        if (group.type === 'income') {
          sums.income += group.totalMinor;
          entry.incomeCount += group.count;
        } else {
          sums.expense += group.totalMinor;
          entry.expenseCount += group.count;
        }
        entry.incomeMinor = serializeMinorUnits(sums.income);
        entry.expenseMinor = serializeMinorUnits(sums.expense);
        entry.netMinor = serializeMinorUnits(sums.income - sums.expense);
        totals.set(currency, sums);
        byCurrency.set(currency, entry);
      }
      return {
        currencies: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      };
    },

    get: load,

    create: (caller, input, idempotencyKey) => {
      const at = now();
      const sameRequest = (existing: TransactionRecord): void => {
        assertSameTransaction(existing, input);
      };
      return recordOnce(caller, idempotencyKey, sameRequest, async (ledger) => {
        // Lock first: a concurrent retry with the same key then waits and sees the first row.
        await ledger.lockAccounts(caller.userId, accountsOfInput(input));
        const replay = await replayIfKnown(ledger, caller, idempotencyKey, sameRequest);
        if (replay !== undefined) {
          return replay;
        }
        const id = await writeLocked(ledger, caller, input, at, undefined, async (write) => {
          const inserted = await ledger.insert(caller.userId, write, idempotencyKey ?? null, at);
          return inserted.id;
        });
        return { id, replayed: false };
      });
    },

    update: async (caller, transactionId, patch) => {
      await repository.inLedger(async (ledger) => {
        const current = await lockOne(ledger, caller, transactionId);
        if (current.voidedAt !== null) {
          throw new AppError(409, 'CONFLICT', 'Restore this transaction before editing it.');
        }
        const merged = mergeTransactionUpdate(current, patch);
        if (!merged.ok) {
          throw invalid(merged.details);
        }
        await writeLocked(ledger, caller, merged.input, now(), current, async (write) => {
          await ledger.update(current.id, write);
          return current.id;
        });
      });
      return load(caller, transactionId);
    },

    void: async (caller, transactionId, input) => {
      await repository.inLedger(async (ledger) => {
        const current = await lockOne(ledger, caller, transactionId);
        // Already voided: nothing changes, so the effect can never be reversed twice.
        if (current.voidedAt === null) {
          await changeVoidState(ledger, caller, [current], {
            at: now(),
            reason: input.reason ?? null,
          });
        }
      });
      return load(caller, transactionId);
    },

    restore: async (caller, transactionId) => {
      await repository.inLedger(async (ledger) => {
        const current = await lockOne(ledger, caller, transactionId);
        if (current.voidedAt !== null) {
          await changeVoidState(ledger, caller, [current], null);
        }
      });
      return load(caller, transactionId);
    },

    bulk: (caller, input) =>
      repository.inLedger(async (ledger) => {
        const locked = await ledger.lockTransactions(caller.userId, input.transactionIds);
        const byId = new Map(locked.map((record) => [record.id, record]));
        const missing = input.transactionIds.flatMap((id, index) =>
          byId.has(id) ? [] : [{ path: `body.transactionIds.${index}`, message: 'Not found.' }],
        );
        if (missing.length > 0) {
          throw new AppError(
            404,
            'NOT_FOUND',
            'Some selected transactions do not exist or are not yours. Nothing was changed.',
            { details: missing },
          );
        }
        const records = input.transactionIds.flatMap((id) => {
          const record = byId.get(id);
          return record === undefined ? [] : [record];
        });
        const requested = records.length;

        if (input.action === 'void') {
          const active = records.filter((record) => record.voidedAt === null);
          const changed =
            active.length === 0
              ? 0
              : await changeVoidState(ledger, caller, active, {
                  at: now(),
                  reason: input.reason ?? null,
                });
          return { action: 'void', requested, changed };
        }

        const problems: ApiErrorDetail[] = [];
        records.forEach((record, index) => {
          if (record.voidedAt !== null) {
            problems.push({
              path: `body.transactionIds.${index}`,
              message: 'Voided transactions cannot change. Restore it first.',
            });
          }
        });
        const accountIds = records.flatMap(accountsOf);
        assertAccountsWritable(await ledger.lockAccounts(caller.userId, accountIds), accountIds);

        if (input.action === 'set_category') {
          const category = await ledger.findCategory(caller.userId, input.categoryId);
          if (category === null) {
            throw invalid([{ path: 'body.categoryId', message: 'Choose one of your categories.' }]);
          }
          if (category.archivedAt !== null) {
            throw invalid([
              { path: 'body.categoryId', message: `“${category.name}” is archived.` },
            ]);
          }
          records.forEach((record, index) => {
            const kind = categoryKindForTransactionType(record.type);
            if (kind !== category.kind) {
              problems.push({
                path: `body.transactionIds.${index}`,
                message:
                  kind === undefined
                    ? 'Transfers and balance adjustments are never categorised.'
                    : `This is ${kind === 'income' ? 'income' : 'an expense'}; choose a matching category.`,
              });
            }
          });
          if (problems.length > 0) {
            throw invalid(problems);
          }
          await ledger.setCategory(
            records.map((record) => record.id),
            category.id,
          );
          const changed = records.filter((record) => record.categoryId !== category.id).length;
          return { action: 'set_category', requested, changed };
        }

        const updates = records.map((record, index) => {
          const tags =
            input.action === 'add_tags'
              ? normalizeTags([...record.tags, ...input.tags])
              : record.tags.filter((tag) => !input.tags.includes(tag));
          if (tags.length > MAX_TAGS_PER_TRANSACTION) {
            problems.push({
              path: `body.transactionIds.${index}`,
              message: `A transaction can have at most ${MAX_TAGS_PER_TRANSACTION} tags.`,
            });
          }
          return { record, tags };
        });
        if (problems.length > 0) {
          throw invalid(problems);
        }
        const changes = updates.filter(
          ({ record, tags }) => tags.join('\u0000') !== record.tags.join('\u0000'),
        );
        for (const { record, tags } of changes) {
          await ledger.setTags(record.id, tags);
        }
        return { action: input.action, requested, changed: changes.length };
      }),

    previewReconciliation: async (caller, input) => {
      const account = await repository.findAccount(caller.userId, input.accountId);
      if (account === null) {
        throw invalid([{ path: 'body.accountId', message: 'Choose one of your accounts.' }]);
      }
      const asOf = new Date(input.asOf);
      const totals =
        (
          await repository.movementTotals(caller.userId, {
            accountIds: [input.accountId],
            asOf,
          })
        ).get(input.accountId) ?? NO_MOVEMENTS;
      const adjustment = evaluateReconciliation(account, input, totals, caller.timeZone, now());
      return {
        accountId: account.record.id,
        currency: currencyCodeSchema.parse(account.record.currency),
        asOf: asOf.toISOString(),
        observedBalanceMinor: input.observedBalanceMinor,
        before: describeAccountBalance(account.record, totals),
        after: describeAccountBalance(
          account.record,
          adjustment === undefined ? totals : withAdjustment(totals, adjustment),
        ),
        ...(adjustment === undefined
          ? {}
          : {
              adjustment: {
                direction: adjustment.direction,
                amountMinor: serializeMinorUnits(adjustment.amountMinor),
              },
            }),
      };
    },

    reconcile: (caller, input, idempotencyKey) => {
      const at = now();
      const sameRequest = (existing: TransactionRecord): void => {
        assertSameReconciliation(existing, input);
      };
      return recordOnce(caller, idempotencyKey, sameRequest, async (ledger) => {
        const accounts = await ledger.lockAccounts(caller.userId, [input.accountId]);
        const replay = await replayIfKnown(ledger, caller, idempotencyKey, sameRequest);
        if (replay !== undefined) {
          return replay;
        }
        const account = accounts.get(input.accountId);
        if (account === undefined) {
          throw invalid([{ path: 'body.accountId', message: 'Choose one of your accounts.' }]);
        }
        // CalmCash's balance at the observed instant, read under the lock.
        const totals =
          (
            await ledger.movementTotals(caller.userId, {
              accountIds: [input.accountId],
              asOf: new Date(input.asOf),
            })
          ).get(input.accountId) ?? NO_MOVEMENTS;
        const adjustment = evaluateReconciliation(account, input, totals, caller.timeZone, at);
        if (adjustment === undefined) {
          throw new AppError(
            409,
            'CONFLICT',
            'The balances already match, so nothing was recorded.',
          );
        }
        if (signedAdjustment(adjustment).toString() !== input.expectedAdjustmentMinor) {
          throw new AppError(
            409,
            'CONFLICT',
            'The balance changed while you were reviewing it. Review the adjustment again.',
          );
        }
        const candidate: CreateBalanceAdjustmentInput = {
          type: 'balance_adjustment',
          accountId: input.accountId,
          adjustmentDirection: adjustment.direction,
          amountMinor: serializeMinorUnits(adjustment.amountMinor),
          occurredAt: input.asOf,
          description: input.description,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
        };
        const id = await writeLocked(ledger, caller, candidate, at, undefined, async (write) => {
          const inserted = await ledger.insert(caller.userId, write, idempotencyKey ?? null, at);
          return inserted.id;
        });
        return { id, replayed: false };
      });
    },

    recordLinked: async (caller, input, link) => {
      const at = now();
      const { id, replayed } = await repository.inLedger(async (ledger) => {
        // The linked rows are locked before any account, so this write queues behind (and then
        // sees) a concurrent one for the same link instead of recording the money twice.
        const recorded = await link.claim(ledger.client);
        if (recorded !== undefined) {
          return { id: recorded, replayed: true };
        }
        const transactionId = await writeLocked(
          ledger,
          caller,
          input,
          at,
          undefined,
          async (write) => (await ledger.insert(caller.userId, write, null, at)).id,
        );
        await link.commit(ledger.client, transactionId);
        return { id: transactionId, replayed: false };
      });
      return { item: await load(caller, id), replayed };
    },
  };
}
