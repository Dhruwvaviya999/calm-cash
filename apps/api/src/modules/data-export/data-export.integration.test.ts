import { API_V1_PREFIX } from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  categoryId,
  createAccount,
  newUser,
  parseError,
  record,
} from '../../testing/finance-helpers';
import { useIntegrationDatabase, withCsrf, type SignedIn } from '../../testing/integration-harness';
import { RECEIPT_SAMPLES } from '../../testing/receipt-samples';

const EXPORT = `${API_V1_PREFIX}/exports/financial-data`;
const { createContext } = useIntegrationDatabase();

const exportSchema = z.looseObject({
  format: z.literal('calmcash-export'),
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  profile: z.looseObject({ email: z.string(), name: z.string() }),
  accounts: z.array(z.looseObject({ id: z.string(), openingBalanceMinor: z.string() })),
  transactions: z.array(
    z.looseObject({ id: z.string(), amountMinor: z.string(), description: z.string() }),
  ),
  receipts: z.array(z.looseObject({ fileName: z.string() })),
  budgets: z.array(z.unknown()),
  recurringSchedules: z.array(z.unknown()),
  financialScenarios: z.array(z.unknown()),
});

async function seed(user: SignedIn, description: string, amountMinor: string): Promise<string> {
  const bank = (
    await createAccount(user, {
      name: 'HDFC',
      type: 'bank',
      currency: 'INR',
      // Near the largest amount the API accepts: must come back digit for digit, as a string.
      openingBalanceMinor: '900719925474099',
      openingBalanceDate: '2026-09-01',
    })
  ).account.id;
  const transaction = await record(user, {
    type: 'expense',
    accountId: bank,
    amountMinor,
    occurredAt: '2026-10-05T06:00:00.000Z',
    description,
    categoryId: await categoryId(user, 'expense', 'Restaurants'),
  });
  return transaction.transaction.id;
}

describe('financial data export', () => {
  it('downloads the person’s own records with exact amounts and no secrets', async () => {
    const context = createContext();
    const user = await newUser(context);
    const transactionId = await seed(user, 'Dinner with friends', '900719925474099');
    await withCsrf(
      user.agent.post(
        `${API_V1_PREFIX}/transactions/${transactionId}/receipts?fileName=dinner.png`,
      ),
      user,
    )
      .set('Content-Type', 'image/png')
      .send(Buffer.from(RECEIPT_SAMPLES.png))
      .expect(201);
    const stranger = await newUser(context);
    await seed(stranger, 'Someone else entirely', '500');

    const response = await user.agent.get(EXPORT).buffer(true).expect(200);

    expect(response.get('Content-Disposition')).toMatch(
      /^attachment; filename="calmcash-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.get('Cache-Control')).toBe('no-store');
    const text = response.text;
    const data = exportSchema.parse(JSON.parse(text));
    expect(data.profile.email).toBe(user.session.user.email);
    expect(data.accounts.map((account) => account.openingBalanceMinor)).toEqual([
      '900719925474099',
    ]);
    expect(data.transactions.map((row) => [row.description, row.amountMinor])).toEqual([
      ['Dinner with friends', '900719925474099'],
    ]);
    expect(data.receipts.map((receipt) => receipt.fileName)).toEqual(['dinner.png']);
    for (const forbidden of [
      'passwordHash',
      'tokenHash',
      'idempotencyKey',
      'storageKey',
      'dedupeKey',
      'Someone else entirely',
      stranger.session.user.email,
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('requires a session and limits how often it runs', async () => {
    const context = createContext({ dataExportRateLimit: { limit: 2, windowMs: 60_000 } });
    await request(context.app).get(EXPORT).expect(401);
    const user = await newUser(context);

    await user.agent.get(EXPORT).expect(200);
    await user.agent.get(EXPORT).expect(200);
    const limited = await user.agent.get(EXPORT).expect(429);
    expect(parseError(limited.body).code).toBe('RATE_LIMITED');
  });
});
