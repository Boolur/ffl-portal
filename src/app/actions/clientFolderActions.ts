'use server';

import { prisma } from '@/lib/prisma';
import { TaskAttachmentPurpose, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import {
  getClientDocumentsBucket,
  getSignedUrlExpirySeconds,
  getSupabaseAdmin,
} from '@/lib/supabaseAdmin';

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const replaced = trimmed.replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, ' ');
  return replaced.length ? replaced : 'file';
}

async function ensureClientForLoan(loanId: string) {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    select: {
      id: true,
      borrowerName: true,
      borrowerPhone: true,
      borrowerEmail: true,
      loanOfficerId: true,
      clientId: true,
    },
  });

  if (!loan) return { ok: false as const, error: 'Loan not found.' };
  if (loan.clientId) return { ok: true as const, clientId: loan.clientId, loan };

  const lead = await prisma.leadMailboxLead.findFirst({
    where: { loanId },
    select: { leadId: true },
  });

  const ownerId = loan.loanOfficerId;
  const phone = loan.borrowerPhone?.trim() || null;
  const leadId = lead?.leadId || null;

  const client = await prisma.$transaction(async (tx) => {
    // Re-check inside transaction to avoid races
    const fresh = await tx.loan.findUnique({
      where: { id: loanId },
      select: { clientId: true },
    });
    if (fresh?.clientId) {
      return await tx.client.findUnique({ where: { id: fresh.clientId } });
    }

    let existingClient =
      phone
        ? await tx.client.findUnique({
            where: { ownerId_phone: { ownerId, phone } },
          })
        : null;

    if (!existingClient && leadId) {
      existingClient = await tx.client.findUnique({
        where: { ownerId_leadId: { ownerId, leadId } },
      });
    }

    const createdOrExisting =
      existingClient ||
      (await tx.client.create({
        data: {
          ownerId,
          phone,
          leadId,
          email: loan.borrowerEmail?.trim() || null,
          displayName: loan.borrowerName || null,
        },
      }));

    await tx.loan.update({
      where: { id: loanId },
      data: { clientId: createdOrExisting.id },
    });

    return createdOrExisting;
  });

  if (!client) return { ok: false as const, error: 'Failed to create client.' };
  return { ok: true as const, clientId: client.id, loan };
}

export async function getClientFolderForLoan(loanId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { loanOfficerId: true },
    });
    if (!loan) return { success: false, error: 'Loan not found.' };

    const canViewAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    if (!canViewAll && loan.loanOfficerId !== userId) {
      return { success: false, error: 'Not authorized.' };
    }

    const ensured = await ensureClientForLoan(loanId);
    if (!ensured.ok) return { success: false, error: ensured.error };

    const docs = await prisma.clientDocument.findMany({
      where: { clientId: ensured.clientId },
      select: {
        id: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        folder: true,
        tags: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { success: true, clientId: ensured.clientId, documents: docs };
  } catch (error) {
    console.error('Failed to load client folder:', error);
    return { success: false, error: 'Failed to load client folder.' };
  }
}

export async function getMyPipelineClients() {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    // Primary use-case: Loan Officers selecting a client from their own pipeline.
    const ownerId = userId;
    const loans = await prisma.loan.findMany({
      where: { loanOfficerId: ownerId },
      select: {
        id: true,
        loanNumber: true,
        borrowerName: true,
        borrowerPhone: true,
        borrowerEmail: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return { success: true, loans };
  } catch (error) {
    console.error('Failed to load pipeline clients:', error);
    return { success: false, error: 'Failed to load pipeline clients.' };
  }
}

export async function attachClientDocumentsToTask(input: {
  taskId: string;
  documentIds: string[];
  purpose?: TaskAttachmentPurpose;
}) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        loan: { select: { loanOfficerId: true } },
      },
    });
    if (!task) return { success: false, error: 'Task not found.' };

    const canViewAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isLoanOwner = role === UserRole.LOAN_OFFICER && task.loan.loanOfficerId === userId;
    if (!canViewAll && !isLoanOwner) {
      return { success: false, error: 'Not authorized.' };
    }

    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { success: true };

    const docs = await prisma.clientDocument.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        storagePath: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        client: { select: { ownerId: true } },
      },
    });

    // Ensure the current LO owns the docs (unless admin/manager)
    if (!canViewAll) {
      const anyForeign = docs.some((d) => d.client.ownerId !== userId);
      if (anyForeign) return { success: false, error: 'Not authorized.' };
    }

    const purpose = input.purpose ?? TaskAttachmentPurpose.OTHER;

    await prisma.taskAttachment.createMany({
      data: docs.map((d) => ({
        taskId: input.taskId,
        clientDocumentId: d.id,
        purpose,
        storagePath: d.storagePath,
        filename: d.filename,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        uploadedById: userId,
      })),
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to attach client docs:', error);
    return { success: false, error: 'Failed to attach documents.' };
  }
}

export async function createClientDocumentUploadUrl(input: {
  loanId: string;
  filename: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      select: { loanOfficerId: true },
    });
    if (!loan) return { success: false, error: 'Loan not found.' };

    const canViewAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    if (!canViewAll && loan.loanOfficerId !== userId) {
      return { success: false, error: 'Not authorized.' };
    }

    const ensured = await ensureClientForLoan(input.loanId);
    if (!ensured.ok) return { success: false, error: ensured.error };

    const safeName = sanitizeFilename(input.filename);
    const storagePath = `clients/${ensured.clientId}/${randomUUID()}-${safeName}`;

    const supabase = getSupabaseAdmin();
    const bucket = getClientDocumentsBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error('[client-docs] createSignedUploadUrl failed', error);
      return { success: false, error: 'Failed to create upload URL.' };
    }

    return {
      success: true,
      clientId: ensured.clientId,
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    };
  } catch (error) {
    console.error('Failed to create upload URL:', error);
    return { success: false, error: 'Failed to create upload URL.' };
  }
}

export async function finalizeClientDocument(input: {
  clientId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  folder?: string;
  tags?: string[];
}) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: { ownerId: true },
    });
    if (!client) return { success: false, error: 'Client not found.' };

    const canViewAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    if (!canViewAll && client.ownerId !== userId) {
      return { success: false, error: 'Not authorized.' };
    }

    const doc = await prisma.clientDocument.create({
      data: {
        clientId: input.clientId,
        storagePath: input.storagePath,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: Math.max(0, Math.floor(input.sizeBytes)),
        folder: input.folder?.trim() || null,
        tags: (input.tags || []).map((t) => t.trim()).filter(Boolean),
        uploadedById: userId,
      },
      select: { id: true },
    });

    revalidatePath('/pipeline');
    return { success: true, documentId: doc.id };
  } catch (error) {
    console.error('Failed to finalize client document:', error);
    return { success: false, error: 'Failed to save document.' };
  }
}

export async function getClientDocumentDownloadUrl(documentId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const doc = await prisma.clientDocument.findUnique({
      where: { id: documentId },
      select: {
        storagePath: true,
        client: { select: { ownerId: true } },
      },
    });
    if (!doc) return { success: false, error: 'Document not found.' };

    const canViewAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    if (!canViewAll && doc.client.ownerId !== userId) {
      return { success: false, error: 'Not authorized.' };
    }

    const supabase = getSupabaseAdmin();
    const bucket = getClientDocumentsBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(doc.storagePath, getSignedUrlExpirySeconds());

    if (error || !data) {
      console.error('[client-docs] createSignedUrl failed', error);
      return { success: false, error: 'Failed to create download URL.' };
    }

    return { success: true, url: data.signedUrl };
  } catch (error) {
    console.error('Failed to get document URL:', error);
    return { success: false, error: 'Failed to get document URL.' };
  }
}

