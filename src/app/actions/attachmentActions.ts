'use server';

import { prisma } from '@/lib/prisma';
import {
  TaskAttachmentPurpose,
  TaskKind,
  UserRole,
} from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import {
  getSignedUrlExpirySeconds,
  getSupabaseAdmin,
  getTaskAttachmentsBucket,
} from '@/lib/supabaseAdmin';
import { randomUUID } from 'crypto';

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const replaced = trimmed.replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, ' ');
  return replaced.length ? replaced : 'file';
}

async function canAccessTaskForAttachment(taskId: string, role: UserRole, userId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      kind: true,
      assignedRole: true,
      assignedUserId: true,
      loan: { select: { loanOfficerId: true } },
    },
  });

  if (!task) return { ok: false as const, error: 'Task not found.' };

  const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isAssignedToUser = task.assignedUserId === userId;
  const isAssignedToRole = task.assignedRole === role;
  const isLoanOwner = role === UserRole.LOAN_OFFICER && task.loan?.loanOfficerId === userId;

  if (!canManageAll && !isAssignedToUser && !isAssignedToRole && !isLoanOwner) {
    return { ok: false as const, error: 'Not authorized.' };
  }

  return { ok: true as const, task };
}

export async function createTaskAttachmentUploadUrl(input: {
  taskId: string;
  purpose: TaskAttachmentPurpose;
  filename: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const access = await canAccessTaskForAttachment(input.taskId, role, userId);
    if (!access.ok) return { success: false, error: access.error };

    // Enforce: VA kinds can only upload PROOF (keeps workflow clean)
    const isVaKind =
      access.task.kind === TaskKind.VA_TITLE ||
      access.task.kind === TaskKind.VA_HOI ||
      access.task.kind === TaskKind.VA_PAYOFF ||
      access.task.kind === TaskKind.VA_APPRAISAL;

    if (isVaKind && input.purpose !== TaskAttachmentPurpose.PROOF) {
      return { success: false, error: 'VA tasks only accept proof uploads.' };
    }

    const safeName = sanitizeFilename(input.filename);
    const storagePath = `tasks/${input.taskId}/${randomUUID()}-${safeName}`;

    const supabase = getSupabaseAdmin();
    const bucket = getTaskAttachmentsBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error('[attachments] createSignedUploadUrl failed', error);
      return { success: false, error: 'Failed to create upload URL.' };
    }

    return {
      success: true,
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    };
  } catch (error) {
    console.error('Failed to create upload URL:', error);
    return { success: false, error: 'Failed to create upload URL.' };
  }
}

export async function finalizeTaskAttachment(input: {
  taskId: string;
  purpose: TaskAttachmentPurpose;
  storagePath: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  clientDocumentId?: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const access = await canAccessTaskForAttachment(input.taskId, role, userId);
    if (!access.ok) return { success: false, error: access.error };

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: input.taskId,
        purpose: input.purpose,
        storagePath: input.storagePath,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: Math.max(0, Math.floor(input.sizeBytes)),
        uploadedById: userId,
        clientDocumentId: input.clientDocumentId ?? null,
      },
    });

    revalidatePath('/tasks');
    return { success: true, attachmentId: attachment.id };
  } catch (error) {
    console.error('Failed to finalize attachment:', error);
    return { success: false, error: 'Failed to save attachment.' };
  }
}

export async function getTaskAttachmentDownloadUrl(attachmentId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const attachment = await prisma.taskAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        storagePath: true,
        taskId: true,
        task: {
          select: {
            assignedRole: true,
            assignedUserId: true,
            loan: { select: { loanOfficerId: true } },
          },
        },
      },
    });

    if (!attachment) return { success: false, error: 'Attachment not found.' };

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isAssignedToUser = attachment.task.assignedUserId === userId;
    const isAssignedToRole = attachment.task.assignedRole === role;
    const isLoanOwner =
      role === UserRole.LOAN_OFFICER && attachment.task.loan.loanOfficerId === userId;

    if (!canManageAll && !isAssignedToUser && !isAssignedToRole && !isLoanOwner) {
      return { success: false, error: 'Not authorized.' };
    }

    const supabase = getSupabaseAdmin();
    const bucket = getTaskAttachmentsBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(attachment.storagePath, getSignedUrlExpirySeconds());

    if (error || !data) {
      console.error('[attachments] createSignedUrl failed', error);
      return { success: false, error: 'Failed to create download URL.' };
    }

    return { success: true, url: data.signedUrl };
  } catch (error) {
    console.error('Failed to get download URL:', error);
    return { success: false, error: 'Failed to get download URL.' };
  }
}

