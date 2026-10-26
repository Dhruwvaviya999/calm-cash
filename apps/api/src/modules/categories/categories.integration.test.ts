import {
  apiSuccessResponseSchema,
  categoryDtoSchema,
  tagListDtoSchema,
  type CategoryDto,
} from '@calmcash/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  categoryId,
  createAccount,
  hoursAgo,
  listCategories,
  newUser,
  parseError,
  postTransaction,
  record,
  TAGS,
  TRANSACTIONS,
} from '../../testing/finance-helpers';
import { useIntegrationDatabase, withCsrf, type SignedIn } from '../../testing/integration-harness';
import { DEFAULT_CATEGORIES } from './default-categories';

const { prisma, createContext } = useIntegrationDatabase();

const categoryEnvelope = apiSuccessResponseSchema(categoryDtoSchema);

const DEFAULT_COUNT = DEFAULT_CATEGORIES.reduce(
  (total, category) => total + 1 + (category.children?.length ?? 0),
  0,
);

async function createCategory(user: SignedIn, body: Record<string, unknown>): Promise<CategoryDto> {
  const response = await withCsrf(user.agent.post(CATEGORIES), user).send(body).expect(201);
  return categoryEnvelope.parse(response.body).data;
}

describe('default categories', () => {
  it('are provisioned once per user, even when requested concurrently', async () => {
    const context = createContext();
    const user = await newUser(context);

    await Promise.all(Array.from({ length: 4 }, () => user.agent.get(CATEGORIES).expect(200)));
    const categories = await listCategories(user);

    expect(categories).toHaveLength(DEFAULT_COUNT);
    expect(await prisma.category.count({ where: { userId: user.session.user.id } })).toBe(
      DEFAULT_COUNT,
    );
    const names = categories.map((category) => `${category.kind}:${category.name}`);
    for (const expected of [
      'expense:Food',
      'expense:Groceries',
      'expense:Transport',
      'expense:Subscriptions',
      'income:Salary',
      'income:Refunds',
    ]) {
      expect(names).toContain(expected);
    }
    // Each top-level category comes directly before its subcategories.
    const food = categories.findIndex((category) => category.name === 'Food');
    expect(categories[food + 1]?.parentId).toBe(categories[food]?.id);
    // "Other" is last within its kind.
    expect(categories.filter((category) => category.kind === 'expense').at(-1)?.name).toBe('Other');
  });

  it('are separate for every user', async () => {
    const context = createContext();
    const alice = await newUser(context);
    const bob = await newUser(context);

    const aliceIds = new Set((await listCategories(alice)).map((category) => category.id));
    const bobCategories = await listCategories(bob);

    expect(bobCategories.some((category) => aliceIds.has(category.id))).toBe(false);
    expect(bobCategories.every((category) => category.userId === bob.session.user.id)).toBe(true);
  });
});

describe('custom categories', () => {
  it('creates categories and subcategories of the same kind', async () => {
    const context = createContext();
    const user = await newUser(context);
    const transport = await categoryId(user, 'expense', 'Transport');

    const pets = await createCategory(user, { name: ' Pets ', kind: 'expense' });
    const metro = await createCategory(user, {
      name: 'Metro card',
      kind: 'expense',
      parentId: transport,
    });

    expect(pets).toMatchObject({ name: 'Pets', kind: 'expense', status: 'active' });
    expect(pets).not.toHaveProperty('parentId');
    expect(metro.parentId).toBe(transport);
  });

  it('rejects duplicates, deep nesting, mismatched kinds, and other users’ parents', async () => {
    const context = createContext();
    const user = await newUser(context);
    const other = await newUser(context);
    const fuel = await categoryId(user, 'expense', 'Fuel');
    const salary = await categoryId(user, 'income', 'Salary');
    const foreign = await categoryId(other, 'expense', 'Food');

    const duplicate = await withCsrf(user.agent.post(CATEGORIES), user)
      .send({ name: 'groceries', kind: 'expense' })
      .expect(409);
    expect(parseError(duplicate.body).details?.[0]?.path).toBe('body.name');
    // The same name is fine for the other kind.
    await createCategory(user, { name: 'Groceries', kind: 'income' });

    for (const body of [
      { name: 'Premium', kind: 'expense', parentId: fuel },
      { name: 'Bonus', kind: 'expense', parentId: salary },
      { name: 'Mine', kind: 'expense', parentId: foreign },
    ]) {
      const response = await withCsrf(user.agent.post(CATEGORIES), user).send(body).expect(400);
      expect(parseError(response.body).details?.[0]?.path).toBe('body.parentId');
    }
    await withCsrf(user.agent.post(CATEGORIES), user)
      .send({ name: 'X', kind: 'expense', userId: other.session.user.id })
      .expect(400);
  });

  it('renames, archives with subcategories, and restores without touching history', async () => {
    const context = createContext();
    const user = await newUser(context);
    const transport = await categoryId(user, 'expense', 'Transport');
    const fuel = await categoryId(user, 'expense', 'Fuel');
    const bank = (
      await createAccount(user, {
        name: 'Bank',
        type: 'bank',
        currency: 'INR',
        openingBalanceMinor: '0',
        openingBalanceDate: '2025-01-01',
      })
    ).account.id;
    const expense = {
      type: 'expense',
      accountId: bank,
      amountMinor: '5000',
      occurredAt: hoursAgo(context.clock.now(), 1),
      description: 'Petrol',
      categoryId: fuel,
    };
    const { transaction } = await record(user, expense);

    const renamed = await withCsrf(user.agent.patch(`${CATEGORIES}/${transport}`), user)
      .send({ name: 'Getting around' })
      .expect(200);
    expect(categoryEnvelope.parse(renamed.body).data.name).toBe('Getting around');

    await withCsrf(user.agent.post(`${CATEGORIES}/${transport}/archive`), user).expect(200);
    const archivedChild = (await listCategories(user)).find((category) => category.id === fuel);
    expect(archivedChild?.status).toBe('archived');

    // Archived categories stay on past transactions but cannot be chosen again.
    const kept = await user.agent.get(`${TRANSACTIONS}/${transaction.id}`).expect(200);
    expect(kept.body).toMatchObject({ data: { category: { id: fuel } } });
    const refused = await postTransaction(user, expense).expect(400);
    expect(parseError(refused.body).details?.[0]?.path).toBe('body.categoryId');
    await withCsrf(user.agent.patch(`${TRANSACTIONS}/${transaction.id}`), user)
      .send({ notes: 'Still allowed: the category did not change' })
      .expect(200);

    const restoreChild = await withCsrf(
      user.agent.post(`${CATEGORIES}/${fuel}/restore`),
      user,
    ).expect(409);
    expect(parseError(restoreChild.body).message).toContain('Getting around');
    await withCsrf(user.agent.post(`${CATEGORIES}/${transport}/restore`), user).expect(200);
    await withCsrf(user.agent.post(`${CATEGORIES}/${fuel}/restore`), user).expect(200);
    await postTransaction(user, expense).expect(201);
  });

  it('never lets one user see or change another user’s categories', async () => {
    const context = createContext();
    const alice = await newUser(context);
    const mallory = await newUser(context);
    const food = await categoryId(alice, 'expense', 'Food');

    await withCsrf(mallory.agent.patch(`${CATEGORIES}/${food}`), mallory)
      .send({ name: 'Mine' })
      .expect(404);
    await withCsrf(mallory.agent.post(`${CATEGORIES}/${food}/archive`), mallory).expect(404);
    await request(context.app).get(CATEGORIES).expect(401);
    expect((await listCategories(alice)).find((category) => category.id === food)?.name).toBe(
      'Food',
    );
  });
});

describe('tags', () => {
  it('lists the caller’s tags by use, ignoring voided transactions and other users', async () => {
    const context = createContext();
    const user = await newUser(context);
    const other = await newUser(context);
    const bank = async (owner: SignedIn): Promise<string> =>
      (
        await createAccount(owner, {
          name: 'Bank',
          type: 'bank',
          currency: 'INR',
          openingBalanceMinor: '0',
          openingBalanceDate: '2025-01-01',
        })
      ).account.id;
    const mine = await bank(user);
    const groceries = await categoryId(user, 'expense', 'Groceries');
    const spend = (tags: string[]): Record<string, unknown> => ({
      type: 'expense',
      accountId: mine,
      amountMinor: '100',
      occurredAt: hoursAgo(context.clock.now(), 1),
      description: 'Tagged',
      categoryId: groceries,
      tags,
    });
    await record(user, spend(['Family', 'work']));
    await record(user, spend(['family']));
    const voided = await record(user, spend(['secret']));
    await withCsrf(user.agent.post(`${TRANSACTIONS}/${voided.transaction.id}/void`), user).expect(
      200,
    );
    await record(other, {
      ...spend(['private']),
      accountId: await bank(other),
      categoryId: await categoryId(other, 'expense', 'Groceries'),
    });

    const response = await user.agent.get(TAGS).expect(200);

    expect(apiSuccessResponseSchema(tagListDtoSchema).parse(response.body).data).toEqual({
      tags: [
        { tag: 'family', count: 2 },
        { tag: 'work', count: 1 },
      ],
    });
  });
});
