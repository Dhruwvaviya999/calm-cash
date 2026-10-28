import {
  API_V1_PREFIX,
  apiSuccessResponseSchema,
  receiptDtoSchema,
  receiptListDtoSchema,
  type ReceiptDto,
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
  TRANSACTIONS,
} from '../../testing/finance-helpers';
import {
  useIntegrationDatabase,
  withCsrf,
  type SignedIn,
  type TestContext,
} from '../../testing/integration-harness';
import { RECEIPT_SAMPLES } from '../../testing/receipt-samples';

const { prisma, createContext } = useIntegrationDatabase();
const receiptEnvelope = apiSuccessResponseSchema(receiptDtoSchema);

interface Setup {
  context: TestContext;
  user: SignedIn;
  bank: string;
  transactionId: string;
}

async function setup(context: TestContext = createContext()): Promise<Setup> {
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
  const transaction = await record(user, {
    type: 'expense',
    accountId: bank,
    amountMinor: '45000',
    occurredAt: '2026-10-05T06:00:00.000Z',
    description: 'Dinner',
    categoryId: await categoryId(user, 'expense', 'Restaurants'),
  });
  return { context, user, bank, transactionId: transaction.transaction.id };
}

function receipts(transactionId: string): string {
  return `${API_V1_PREFIX}/transactions/${transactionId}/receipts`;
}

function upload(
  user: SignedIn,
  transactionId: string,
  content: Uint8Array,
  fileName: string,
  contentType = 'application/octet-stream',
): request.Test {
  return withCsrf(
    user.agent.post(`${receipts(transactionId)}?fileName=${encodeURIComponent(fileName)}`),
    user,
  )
    .set('Content-Type', contentType)
    .send(Buffer.from(content));
}

async function uploaded(
  user: SignedIn,
  transactionId: string,
  content: Uint8Array,
  fileName: string,
  contentType?: string,
): Promise<ReceiptDto> {
  const response = await upload(user, transactionId, content, fileName, contentType);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return receiptEnvelope.parse(response.body).data;
}

describe('receipts', () => {
  it('stores JPEG, PNG, WebP, and PDF receipts privately and serves them only to their owner', async () => {
    const { context, user, bank, transactionId } = await setup();
    const balance = await balanceOf(user, bank);
    const jpeg = await uploaded(
      user,
      transactionId,
      RECEIPT_SAMPLES.jpeg,
      'dinner.jpg',
      'image/jpeg',
    );
    const png = await uploaded(user, transactionId, RECEIPT_SAMPLES.png, 'bill.PNG');
    await uploaded(user, transactionId, RECEIPT_SAMPLES.webp, 'photo.webp', 'image/webp');
    const pdf = await uploaded(
      user,
      transactionId,
      RECEIPT_SAMPLES.pdf,
      '../../etc/invoice.pdf',
      'application/pdf',
    );
    expect(jpeg).toMatchObject({
      contentType: 'image/jpeg',
      fileName: 'dinner.jpg',
      sizeBytes: RECEIPT_SAMPLES.jpeg.length,
    });
    expect(png.contentType).toBe('image/png');
    // Path segments are dropped from names; storage keys are random and never sent.
    expect(pdf.fileName).toBe('invoice.pdf');
    expect(Object.keys(pdf).sort()).toEqual([
      'contentType',
      'createdAt',
      'fileName',
      'id',
      'sha256',
      'sizeBytes',
      'transactionId',
    ]);
    expect(context.storage.keys()).toHaveLength(4);

    const list = apiSuccessResponseSchema(receiptListDtoSchema).parse(
      (await user.agent.get(receipts(transactionId)).expect(200)).body,
    ).data;
    expect(list.receipts.map((receipt) => receipt.fileName)).toEqual([
      'dinner.jpg',
      'bill.PNG',
      'photo.webp',
      'invoice.pdf',
    ]);

    const file = await user.agent
      .get(`${receipts(transactionId)}/${pdf.id}/file?disposition=inline`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          done(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    // PDFs are always downloads, never rendered inline.
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="invoice.pdf"/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.isBuffer(file.body) && file.body.equals(Buffer.from(RECEIPT_SAMPLES.pdf))).toBe(
      true,
    );
    const image = await user.agent
      .get(`${receipts(transactionId)}/${png.id}/file?disposition=inline`)
      .expect(200);
    expect(image.headers['content-disposition']).toMatch(/^inline;/);

    const other = await newUser(createContext());
    await other.agent.get(receipts(transactionId)).expect(404);
    await other.agent.get(`${receipts(transactionId)}/${pdf.id}/file`).expect(404);
    await withCsrf(other.agent.delete(`${receipts(transactionId)}/${pdf.id}`), other).expect(404);
    await upload(other, transactionId, RECEIPT_SAMPLES.png, 'x.png').expect(404);

    // A receipt of another transaction cannot be reached through this one.
    const second = await record(user, {
      type: 'expense',
      accountId: bank,
      amountMinor: '1000',
      occurredAt: '2026-10-06T06:00:00.000Z',
      description: 'Tea',
      categoryId: await categoryId(user, 'expense', 'Restaurants'),
    });
    await user.agent.get(`${receipts(second.transaction.id)}/${pdf.id}/file`).expect(404);

    // Removing a receipt leaves the transaction exactly as it was.
    await withCsrf(user.agent.delete(`${receipts(transactionId)}/${pdf.id}`), user).expect(200);
    expect(context.storage.keys()).toHaveLength(3);
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    expect(transaction).toMatchObject({ voidedAt: null, amountMinor: 45_000n });
    expect(await balanceOf(user, bank)).toBe(balance - 1000n);
  });

  it('refuses disguised, damaged, unsupported, and oversized files', async () => {
    const { context, user, transactionId } = await setup();
    const disguised = await upload(user, transactionId, RECEIPT_SAMPLES.pdf, 'photo.png').expect(
      400,
    );
    expect(parseError(disguised.body).message).toContain('content is a PDF');
    await upload(user, transactionId, RECEIPT_SAMPLES.png, 'bill.png', 'application/pdf').expect(
      400,
    );
    await upload(
      user,
      transactionId,
      new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
      'x.png',
      'image/png',
    ).expect(400);
    await upload(user, transactionId, RECEIPT_SAMPLES.png.subarray(0, 30), 'cut.png').expect(400);
    await upload(user, transactionId, new Uint8Array(), 'empty.png').expect(400);
    await upload(user, transactionId, new Uint8Array(10 * 1024 * 1024 + 1), 'huge.png').expect(413);
    expect(context.storage.keys()).toHaveLength(0);
  });

  it('keeps metadata and files consistent when storage or limits fail', async () => {
    let failRemovals = false;
    const context = createContext({
      receiptStorage: (real) => ({
        ...real,
        remove: (key) =>
          failRemovals ? Promise.reject(new Error('Disk unavailable')) : real.remove(key),
      }),
    });
    const { user, bank, transactionId } = await setup(context);
    for (let index = 0; index < 10; index += 1) {
      await uploaded(user, transactionId, RECEIPT_SAMPLES.png, `page-${String(index)}.png`);
    }
    // The eleventh is refused after the file was written: the file is removed again.
    await upload(user, transactionId, RECEIPT_SAMPLES.png, 'page-10.png').expect(409);
    expect(context.storage.keys()).toHaveLength(10);
    expect(await prisma.transactionReceipt.count()).toBe(10);

    const [first] = await prisma.transactionReceipt.findMany({ take: 1 });
    failRemovals = true;
    const failed = await withCsrf(
      user.agent.delete(`${receipts(transactionId)}/${first?.id ?? ''}`),
      user,
    ).expect(503);
    expect(parseError(failed.body).message).toContain('Nothing was changed');
    expect(await prisma.transactionReceipt.count()).toBe(10);
    failRemovals = false;

    // Receipts on archived accounts are read-only.
    await withCsrf(user.agent.post(`${ACCOUNTS}/${bank}/archive`), user).expect(200);
    await upload(user, transactionId, RECEIPT_SAMPLES.png, 'late.png').expect(409);
    await user.agent.get(receipts(transactionId)).expect(200);
    await user.agent.get(`${TRANSACTIONS}/${transactionId}`).expect(200);
  });
});
