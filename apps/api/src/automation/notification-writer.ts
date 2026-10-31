import type { NotificationTargetDto, NotificationType } from '@calmcash/shared';

import type { PrismaClient } from '../generated/prisma/client';
import type { NotificationText } from './notification-text';

// Creates notifications idempotently. A notification's identity is its user plus `dedupeKey`; the
// insert skips an existing identity (`ON CONFLICT DO NOTHING` on the unique index), so a repeated
// or concurrent job can never create a second record for the same logical event. The e-mail
// delivery row is written in the same transaction as the notification it belongs to.

export interface NotificationDraft extends NotificationText {
  userId: string;
  type: NotificationType;
  dedupeKey: string;
  target: NotificationTargetDto | undefined;
  /** The person's channels for this type, decided by the caller from their preferences. */
  channels: { inApp: boolean; email: boolean };
  /** After this instant the e-mail is not worth sending (e.g. the payment is already due). */
  emailExpiresAt: Date | undefined;
}

export type WriteOutcome = 'created' | 'exists' | 'not_wanted';

export interface NotificationWriter {
  /**
   * Creates the notification unless it already exists or no channel wants it. An e-mail is
   * queued only when the person chose e-mail for this type and their address is verified.
   */
  write: (draft: NotificationDraft, emailVerified: boolean, now: Date) => Promise<WriteOutcome>;
  /** Identities that already exist among `dedupeKeys` (the user's own only). */
  existingKeys: (userId: string, dedupeKeys: readonly string[]) => Promise<Set<string>>;
}

export function createNotificationWriter(prisma: PrismaClient): NotificationWriter {
  return {
    write: async (draft, emailVerified, now) => {
      const email = draft.channels.email && emailVerified;
      if (!draft.channels.inApp && !email) {
        return 'not_wanted';
      }
      return prisma.$transaction(async (tx) => {
        const created = await tx.notification.createManyAndReturn({
          data: [
            {
              userId: draft.userId,
              type: draft.type,
              dedupeKey: draft.dedupeKey,
              title: draft.title,
              body: draft.body,
              ...(draft.target === undefined ? {} : { target: { ...draft.target } }),
              inApp: draft.channels.inApp,
              createdAt: now,
              updatedAt: now,
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        const [notification] = created;
        if (notification === undefined) {
          return 'exists';
        }
        if (email) {
          await tx.notificationDelivery.create({
            data: {
              notificationId: notification.id,
              userId: draft.userId,
              nextAttemptAt: now,
              expiresAt: draft.emailExpiresAt ?? null,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        return 'created';
      });
    },

    existingKeys: async (userId, dedupeKeys) => {
      if (dedupeKeys.length === 0) return new Set();
      const rows = await prisma.notification.findMany({
        where: { userId, dedupeKey: { in: [...dedupeKeys] } },
        select: { dedupeKey: true },
      });
      return new Set(rows.map((row) => row.dedupeKey));
    },
  };
}
