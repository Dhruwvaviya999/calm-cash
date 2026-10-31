import {
  assistantBlockDtoSchema,
  type AiDismissalKind,
  type AssistantBlockDto,
  type AssistantOutcome,
} from '@calmcash/shared';
import { z } from 'zod';

import type {
  AiConversation,
  AiMerchantRule,
  AiMessage,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { toInputJson } from '../../lib/json-value';

// Persistence of the AI features. Every query is scoped by the owner's user ID: another user's
// conversation answers exactly like a missing one. Messages keep only what the person saw.

export type ConversationRecord = AiConversation;
export type MessageRecord = AiMessage;
export type MerchantRuleRecord = AiMerchantRule;

export interface NewMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: AssistantBlockDto[];
  followUps: string[];
  outcome?: AssistantOutcome | undefined;
  narrative?: 'assistant' | 'template' | undefined;
}

export interface CategorizedExample {
  type: 'income' | 'expense';
  merchant: string | null;
  description: string;
  categoryId: string;
}

export interface AiRepository {
  preference: (userId: string) => Promise<{ enabled: boolean; updatedAt: Date } | null>;
  setPreference: (
    userId: string,
    enabled: boolean,
  ) => Promise<{ enabled: boolean; updatedAt: Date }>;

  conversations: (userId: string, limit: number) => Promise<ConversationRecord[]>;
  conversation: (userId: string, conversationId: string) => Promise<ConversationRecord | null>;
  createConversation: (userId: string, title: string) => Promise<ConversationRecord>;
  renameConversation: (userId: string, conversationId: string, title: string) => Promise<boolean>;
  deleteConversation: (userId: string, conversationId: string) => Promise<boolean>;
  deleteAllConversations: (userId: string) => Promise<number>;
  /** Newest `limit` messages, oldest first. */
  messages: (userId: string, conversationId: string, limit: number) => Promise<MessageRecord[]>;
  addMessages: (
    userId: string,
    conversationId: string,
    messages: readonly NewMessage[],
  ) => Promise<MessageRecord[]>;

  /** The user's own categorised income and expenses, newest first, for "your history" matches. */
  categorizedExamples: (userId: string, limit: number) => Promise<CategorizedExample[]>;

  merchantRules: (userId: string) => Promise<MerchantRuleRecord[]>;
  saveMerchantRule: (
    userId: string,
    patternKey: string,
    merchant: string,
  ) => Promise<MerchantRuleRecord>;
  deleteMerchantRule: (userId: string, ruleId: string) => Promise<boolean>;

  dismissals: (
    userId: string,
    kind: AiDismissalKind,
  ) => Promise<{ subjectKey: string; value: string }[]>;
  dismiss: (
    userId: string,
    kind: AiDismissalKind,
    subjectKey: string,
    value?: string,
  ) => Promise<void>;
}

const blocksSchema = z.array(assistantBlockDtoSchema);

/** Stored blocks, re-validated on every read (a malformed row shows no blocks). */
export function readBlocks(value: Prisma.JsonValue): AssistantBlockDto[] {
  const parsed = blocksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function createPrismaAiRepository(prisma: PrismaClient): AiRepository {
  return {
    preference: (userId) =>
      prisma.aiPreference.findUnique({
        where: { userId },
        select: { enabled: true, updatedAt: true },
      }),

    setPreference: (userId, enabled) =>
      prisma.aiPreference.upsert({
        where: { userId },
        create: { userId, enabled },
        update: { enabled },
        select: { enabled: true, updatedAt: true },
      }),

    conversations: (userId, limit) =>
      prisma.aiConversation.findMany({
        where: { userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),

    conversation: (userId, conversationId) =>
      prisma.aiConversation.findFirst({ where: { id: conversationId, userId } }),

    createConversation: (userId, title) =>
      prisma.aiConversation.create({ data: { userId, title } }),

    renameConversation: async (userId, conversationId, title) => {
      const { count } = await prisma.aiConversation.updateMany({
        where: { id: conversationId, userId },
        data: { title },
      });
      return count > 0;
    },

    deleteConversation: async (userId, conversationId) => {
      const { count } = await prisma.aiConversation.deleteMany({
        where: { id: conversationId, userId },
      });
      return count > 0;
    },

    deleteAllConversations: async (userId) => {
      const { count } = await prisma.aiConversation.deleteMany({ where: { userId } });
      return count;
    },

    messages: async (userId, conversationId, limit) => {
      const rows = await prisma.aiMessage.findMany({
        where: { userId, conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.reverse();
    },

    addMessages: (userId, conversationId, messages) =>
      prisma.$transaction(async (tx) => {
        const created: MessageRecord[] = [];
        for (const message of messages) {
          created.push(
            await tx.aiMessage.create({
              data: {
                userId,
                conversationId,
                role: message.role,
                content: message.content,
                blocks: toInputJson(message.blocks),
                followUps: message.followUps,
                outcome: message.outcome ?? null,
                narrative: message.narrative ?? null,
              },
            }),
          );
        }
        // Touch the conversation so it sorts first.
        await tx.aiConversation.updateMany({
          where: { id: conversationId, userId },
          data: { updatedAt: new Date() },
        });
        return created;
      }),

    categorizedExamples: async (userId, limit) => {
      const rows = await prisma.transaction.findMany({
        where: {
          userId,
          voidedAt: null,
          type: { in: ['income', 'expense'] },
          categoryId: { not: null },
        },
        select: { type: true, merchant: true, description: true, categoryId: true },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.flatMap((row): CategorizedExample[] =>
        (row.type === 'income' || row.type === 'expense') && row.categoryId !== null
          ? [
              {
                type: row.type,
                merchant: row.merchant,
                description: row.description,
                categoryId: row.categoryId,
              },
            ]
          : [],
      );
    },

    merchantRules: (userId) =>
      prisma.aiMerchantRule.findMany({
        where: { userId },
        orderBy: { patternKey: 'asc' },
        take: 500,
      }),

    saveMerchantRule: (userId, patternKey, merchant) =>
      prisma.aiMerchantRule.upsert({
        where: { userId_patternKey: { userId, patternKey } },
        create: { userId, patternKey, merchant },
        update: { merchant },
      }),

    deleteMerchantRule: async (userId, ruleId) => {
      const { count } = await prisma.aiMerchantRule.deleteMany({ where: { id: ruleId, userId } });
      return count > 0;
    },

    dismissals: (userId, kind) =>
      prisma.aiDismissal.findMany({
        where: { userId, kind },
        select: { subjectKey: true, value: true },
        take: 5_000,
      }),

    dismiss: async (userId, kind, subjectKey, value = '') => {
      await prisma.aiDismissal.createMany({
        data: [{ userId, kind, subjectKey, value }],
        skipDuplicates: true,
      });
    },
  };
}
