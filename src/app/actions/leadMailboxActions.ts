'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

const PROVIDER = 'LEAD_MAILBOX';

async function resolveAdminActorId() {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return admin?.id || null;
}

export async function saveLeadMailboxMapping(externalId: string, userId: string) {
  const trimmedExternalId = externalId.trim();
  if (!trimmedExternalId || !userId) {
    return { success: false, error: 'External ID and user are required.' };
  }

  const mapping = await prisma.externalUser.upsert({
    where: {
      provider_externalId: {
        provider: PROVIDER,
        externalId: trimmedExternalId,
      },
    },
    update: {
      userId,
    },
    create: {
      provider: PROVIDER,
      externalId: trimmedExternalId,
      userId,
    },
  });

  const actorId = await resolveAdminActorId();
  if (actorId) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'LEAD_MAILBOX_MAPPING_UPSERT',
        details: JSON.stringify({
          externalId: trimmedExternalId,
          userId,
          mappingId: mapping.id,
        }),
      },
    });
  }

  revalidatePath('/admin/lead-mailbox');
  return { success: true };
}

export async function deleteLeadMailboxMapping(mappingId: string) {
  const mapping = await prisma.externalUser.findUnique({
    where: { id: mappingId },
    select: { externalId: true, userId: true },
  });

  await prisma.externalUser.delete({
    where: { id: mappingId },
  });

  const actorId = await resolveAdminActorId();
  if (actorId && mapping) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'LEAD_MAILBOX_MAPPING_DELETE',
        details: JSON.stringify({
          externalId: mapping.externalId,
          userId: mapping.userId,
          mappingId,
        }),
      },
    });
  }

  revalidatePath('/admin/lead-mailbox');
  return { success: true };
}

type BulkMappingRow = {
  externalId: string;
  userEmail?: string;
  userId?: string;
};

export async function bulkUpsertLeadMailboxMappings(rows: BulkMappingRow[]) {
  if (rows.length === 0) {
    return { success: false, error: 'No rows to import.' };
  }

  const emails = rows
    .map((row) => row.userEmail?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));

  const usersByEmail = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : [];

  const emailMap = new Map(
    usersByEmail.map((user: { email: string; id: string }) => [
      user.email.toLowerCase(),
      user.id,
    ])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const trimmedExternalId = row.externalId.trim();
    const resolvedUserId =
      row.userId?.trim() ||
      (row.userEmail ? emailMap.get(row.userEmail.toLowerCase()) : undefined);

    if (!trimmedExternalId || !resolvedUserId) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.externalUser.findUnique({
      where: {
        provider_externalId: {
          provider: PROVIDER,
          externalId: trimmedExternalId,
        },
      },
    });

    await prisma.externalUser.upsert({
      where: {
        provider_externalId: {
          provider: PROVIDER,
          externalId: trimmedExternalId,
        },
      },
      update: {
        userId: resolvedUserId,
      },
      create: {
        provider: PROVIDER,
        externalId: trimmedExternalId,
        userId: resolvedUserId,
      },
    });

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  const actorId = await resolveAdminActorId();
  if (actorId) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'LEAD_MAILBOX_MAPPING_BULK_IMPORT',
        details: JSON.stringify({ created, updated, skipped }),
      },
    });
  }

  revalidatePath('/admin/lead-mailbox');
  return { success: true, created, updated, skipped };
}
