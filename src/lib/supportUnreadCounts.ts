import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** IDs must come from the caller's authorized conversation query. */
export async function getSupportUnreadCounts(conversationIds: string[], userId: string) {
  const ids = [...new Set(conversationIds)];
  if (ids.length === 0) return new Map<string, number>();
  // Compare every message against its own conversation's read cursor in one
  // query, rather than issuing a read-state lookup and count for each row.
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; unreadCount: number }>>(Prisma.sql`
    SELECT m."conversationId", COUNT(*)::int AS "unreadCount"
    FROM "SupportMessage" m
    LEFT JOIN "SupportConversationReadState" r
      ON r."conversationId" = m."conversationId" AND r."userId" = ${userId}
    WHERE m."conversationId" IN (${Prisma.join(ids)})
      AND m."authorId" <> ${userId}
      AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
    GROUP BY m."conversationId"
  `);
  return new Map(rows.map((row) => [row.conversationId, row.unreadCount]));
}
