import { prisma, type Tx } from "../db.js";
import { publishToUser } from "../realtime.js";

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Same key for the same underlying event → stored once. */
  dedupeKey: string;
}

/**
 * Idempotent in-app notification. Respects the user's per-type preference and
 * never creates duplicates (unique userId+dedupeKey).
 */
export async function notify(input: NotificationInput, tx: Tx = prisma): Promise<void> {
  const pref = await tx.notificationPreference.findUnique({
    where: { userId_type: { userId: input.userId, type: input.type } },
  });
  if (pref && !pref.inApp) return;
  const result = await tx.notification.createMany({
    data: [
      {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey,
      },
    ],
    skipDuplicates: true,
  });
  if (result.count > 0) publishToUser(input.userId, { type: "notification", title: input.title });
}

export async function notifyMany(userIds: Iterable<string>, input: Omit<NotificationInput, "userId">, tx: Tx = prisma) {
  for (const userId of new Set(userIds)) await notify({ ...input, userId }, tx);
}
