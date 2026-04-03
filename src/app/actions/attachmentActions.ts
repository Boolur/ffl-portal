'use server';

import { prisma } from '@/lib/prisma';
import {
  TaskAttachmentPurpose,
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
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
import { canLoanOfficerViewLoan } from '@/lib/loanOfficerVisibility';

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const replaced = trimmed.replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, ' ');
  return replaced.length ? replaced : 'file';
}

function canBypassDeskStartLock(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

function isStartLockedDeskAttachmentTask(task: {
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState | null;
}) {
  if (!task.kind) return false;
  const isDeskKind =
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    task.kind === TaskKind.SUBMIT_QC ||
    task.kind === TaskKind.VA_TITLE ||
    task.kind === TaskKind.VA_PAYOFF ||
    task.kind === TaskKind.VA_APPRAISAL ||
    task.kind === TaskKind.VA_HOI;
  return isDeskKind && task.status === TaskStatus.PENDING && task.workflowState === TaskWorkflowState.NONE;
}

async function canAccessTaskForAttachment(taskId: string, role: UserRole, userId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      kind: true,
      status: true,
      workflowState: true,
      assignedRole: true,
      assignedUserId: true,
      loan: {
        select: {
          loanOfficerId: true,
          secondaryLoanOfficerId: true,
          visibilitySubmitterUserId: true,
        },
      },
    },
  });

  if (!task) return { ok: false as const, error: 'Task not found.' };

  const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isAssignedToUser = task.assignedUserId === userId;
  const isAssignedToRole =
    task.assignedRole === role ||
    (role === UserRole.PROCESSOR_JR &&
      (task.assignedRole === UserRole.VA_HOI || task.kind === TaskKind.VA_HOI)) ||
    (role === UserRole.VA &&
      (task.assignedRole === UserRole.VA_TITLE ||
        task.assignedRole === UserRole.VA_PAYOFF ||
        task.assignedRole === UserRole.VA_APPRAISAL ||
        task.kind === TaskKind.VA_TITLE ||
        task.kind === TaskKind.VA_PAYOFF ||
        task.kind === TaskKind.VA_APPRAISAL));
  const isLoanOwner =
    role === UserRole.LOAN_OFFICER &&
    task.loan &&
    canLoanOfficerViewLoan(task.loan, userId);

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
    if (!canBypassDeskStartLock(role) && isStartLockedDeskAttachmentTask(access.task)) {
      return { success: false, error: 'Start this task before uploading proof attachments.' };
    }

    // Enforce: VA kinds can only upload PROOF (keeps workflow clean)
    const isVaKind =
      access.task.kind === TaskKind.VA_TITLE ||
      access.task.kind === TaskKind.VA_HOI ||
      access.task.kind === TaskKind.VA_PAYOFF ||
      access.task.kind === TaskKind.VA_APPRAISAL;

    if (isVaKind && input.purpose !== TaskAttachmentPurpose.PROOF) {
      return { success: false, error: 'VA tasks only accept proof uploads.' };
    }
    if (access.task.kind === TaskKind.VA_HOI && access.task.status === TaskStatus.COMPLETED) {
      return {
        success: false,
        error: 'JR proof uploads are locked after task completion.',
      };
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
    if (!canBypassDeskStartLock(role) && isStartLockedDeskAttachmentTask(access.task)) {
      return { success: false, error: 'Start this task before uploading proof attachments.' };
    }
    if (access.task.kind === TaskKind.VA_HOI && access.task.status === TaskStatus.COMPLETED) {
      return {
        success: false,
        error: 'JR proof uploads are locked after task completion.',
      };
    }

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
            loan: {
              select: {
                loanOfficerId: true,
                secondaryLoanOfficerId: true,
                visibilitySubmitterUserId: true,
              },
            },
          },
        },
      },
    });

    if (!attachment) return { success: false, error: 'Attachment not found.' };

    const canManageAll =
      role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.LOA;
    const isAssignedToUser = attachment.task.assignedUserId === userId;
    const isAssignedToRole = attachment.task.assignedRole === role;
    const isLoanOwner =
      role === UserRole.LOAN_OFFICER &&
      canLoanOfficerViewLoan(attachment.task.loan, userId);

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

export async function deleteTaskAttachment(attachmentId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const attachment = await prisma.taskAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        purpose: true,
        storagePath: true,
        uploadedById: true,
        task: {
          select: {
            id: true,
            kind: true,
            status: true,
            workflowState: true,
            assignedRole: true,
            assignedUserId: true,
            loan: {
              select: {
                loanOfficerId: true,
                secondaryLoanOfficerId: true,
                visibilitySubmitterUserId: true,
              },
            },
          },
        },
      },
    });

    if (!attachment) return { success: false, error: 'Attachment not found.' };

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isDisclosureUser = role === UserRole.DISCLOSURE_SPECIALIST;
    const isVaUser =
      role === UserRole.VA ||
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL ||
      role === UserRole.PROCESSOR_JR;

    if (attachment.purpose !== TaskAttachmentPurpose.PROOF) {
      return { success: false, error: 'Only proof attachments can be deleted here.' };
    }

    const isDisclosureTask = attachment.task.kind === TaskKind.SUBMIT_DISCLOSURES;
    const isVaTask =
      attachment.task.kind === TaskKind.VA_TITLE ||
      attachment.task.kind === TaskKind.VA_HOI ||
      attachment.task.kind === TaskKind.VA_PAYOFF ||
      attachment.task.kind === TaskKind.VA_APPRAISAL;

    if (!isDisclosureTask && !isVaTask) {
      return {
        success: false,
        error: 'Attachment deletion is only available on disclosure or VA proof tasks.',
      };
    }

    if (!canManageAll) {
      if (isDisclosureTask && !isDisclosureUser) {
        return { success: false, error: 'Not authorized.' };
      }
      if (isVaTask && !isVaUser) {
        return { success: false, error: 'Not authorized.' };
      }
    }

    if (isDisclosureTask) {
      if (
        attachment.task.status === TaskStatus.BLOCKED ||
        attachment.task.status === TaskStatus.COMPLETED ||
        attachment.task.workflowState === TaskWorkflowState.WAITING_ON_LO ||
        attachment.task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL
      ) {
        return {
          success: false,
          error: 'Attachments can only be deleted before sending the task to LO.',
        };
      }
    }

    if (isVaTask && attachment.task.status === TaskStatus.COMPLETED) {
      return {
        success: false,
        error: 'Attachments cannot be deleted after the VA task is completed.',
      };
    }

    if (!canManageAll) {
      const isAssignedToRole = attachment.task.assignedRole === role;
      const isAssignedToUser = attachment.task.assignedUserId === userId;
      const isUploader = attachment.uploadedById === userId;
      if (!isAssignedToRole && !isAssignedToUser && !isUploader) {
        return { success: false, error: 'Not authorized.' };
      }
    }

    const supabase = getSupabaseAdmin();
    const bucket = getTaskAttachmentsBucket();
    const { error: storageError } = await supabase.storage
      .from(bucket)
      .remove([attachment.storagePath]);
    if (storageError) {
      console.error('[attachments] remove failed', storageError);
    }

    await prisma.taskAttachment.delete({ where: { id: attachmentId } });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task attachment:', error);
    return { success: false, error: 'Failed to delete attachment.' };
  }
}

