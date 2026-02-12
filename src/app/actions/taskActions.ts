'use server';

import { prisma } from '@/lib/prisma';
import { TaskKind, TaskPriority, TaskStatus, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) {
      return { success: false, error: 'Not authenticated.' };
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        kind: true,
        assignedRole: true,
        assignedUserId: true,
        loanId: true,
        loan: { select: { loanOfficerId: true } },
      },
    });

    if (!existing) return { success: false, error: 'Task not found.' };

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isAssignedToUser = existing.assignedUserId === userId;
    const isAssignedToRole = existing.assignedRole === role;
    const isLoanOwner =
      role === UserRole.LOAN_OFFICER && existing.loan?.loanOfficerId === userId;

    if (!canManageAll && !isAssignedToUser && !isAssignedToRole && !isLoanOwner) {
      return { success: false, error: 'Not authorized to update this task.' };
    }

    const isVaKind =
      existing.kind === TaskKind.VA_TITLE ||
      existing.kind === TaskKind.VA_HOI ||
      existing.kind === TaskKind.VA_PAYOFF ||
      existing.kind === TaskKind.VA_APPRAISAL;

    const isVaRole =
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_HOI ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL;

    if (newStatus === TaskStatus.COMPLETED && (isVaKind || isVaRole)) {
      const proofCount = await prisma.taskAttachment.count({
        where: { taskId, purpose: 'PROOF' },
      });
      if (proofCount < 1) {
        return {
          success: false,
          error: 'Upload proof (PDF/Image) before completing this VA task.',
        };
      }
    }

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
        completedAt: newStatus === 'COMPLETED' ? new Date() : null,
      },
    });

    // QC completion → auto-create VA tasks (idempotent)
    if (newStatus === TaskStatus.COMPLETED) {
      const isDisclosuresSubmission =
        existing.kind === TaskKind.SUBMIT_DISCLOSURES ||
        (existing.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
          existing.title.toLowerCase().includes('disclosure'));

      if (isDisclosuresSubmission) {
        await prisma.loan.update({
          where: { id: existing.loanId },
          data: { stage: 'DISCLOSURES_SENT' },
        });
      }

      const isQcSubmission =
        existing.kind === TaskKind.SUBMIT_QC ||
        (existing.assignedRole === UserRole.QC &&
          existing.title.toLowerCase().includes('qc'));

      if (isQcSubmission) {
        await prisma.$transaction(async (tx) => {
          const existingKinds = await tx.task.findMany({
            where: { loanId: existing.loanId },
            select: { kind: true, assignedRole: true },
          });

          const has = (kind: TaskKind, role: UserRole) =>
            existingKinds.some(
              (t) => t.kind === kind || t.assignedRole === role
            );

          const toCreate: { kind: TaskKind; assignedRole: UserRole; title: string }[] =
            [];

          if (!has(TaskKind.VA_TITLE, UserRole.VA_TITLE)) {
            toCreate.push({
              kind: TaskKind.VA_TITLE,
              assignedRole: UserRole.VA_TITLE,
              title: 'VA: Title',
            });
          }
          if (!has(TaskKind.VA_HOI, UserRole.VA_HOI)) {
            toCreate.push({
              kind: TaskKind.VA_HOI,
              assignedRole: UserRole.VA_HOI,
              title: 'VA: HOI',
            });
          }
          if (!has(TaskKind.VA_PAYOFF, UserRole.VA_PAYOFF)) {
            toCreate.push({
              kind: TaskKind.VA_PAYOFF,
              assignedRole: UserRole.VA_PAYOFF,
              title: 'VA: Payoff',
            });
          }
          if (!has(TaskKind.VA_APPRAISAL, UserRole.VA_APPRAISAL)) {
            toCreate.push({
              kind: TaskKind.VA_APPRAISAL,
              assignedRole: UserRole.VA_APPRAISAL,
              title: 'VA: Appraisal',
            });
          }

          if (toCreate.length) {
            await tx.task.createMany({
              data: toCreate.map((t) => ({
                loanId: existing.loanId,
                title: t.title,
                kind: t.kind,
                status: TaskStatus.PENDING,
                priority: TaskPriority.NORMAL,
                assignedRole: t.assignedRole,
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
              })),
            });
          }

          // Move loan forward to next workflow stage (keeps Leads vs Active clean)
          await tx.loan.update({
            where: { id: existing.loanId },
            data: { stage: 'SUBMIT_TO_UW_PREP' },
          });
        });
      }
    }
    
    revalidatePath('/tasks');
    return { success: true };
  } catch (error) {
    console.error('Failed to update task:', error);
    return { success: false, error: 'Failed to update task' };
  }
}

type SubmissionType = 'DISCLOSURES' | 'QC';

type SubmissionPayload = {
  submissionType: SubmissionType;
  loanOfficerName?: string;
  borrowerFirstName: string;
  borrowerLastName: string;
  borrowerPhone?: string;
  borrowerEmail?: string;
  arriveLoanNumber: string;
  loanAmount?: string;
  notes?: string;
};

export async function createSubmissionTask(payload: SubmissionPayload) {
  try {
    const {
      submissionType,
      loanOfficerName,
      borrowerFirstName,
      borrowerLastName,
      borrowerPhone,
      borrowerEmail,
      arriveLoanNumber,
      loanAmount,
      notes,
    } = payload;

    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const sessionUserId = session?.user?.id as string | undefined;

    // Prefer the session user as the loan officer when possible.
    // (Keeps pipelines isolated per-LO and avoids name-based lookups.)
    let loanOfficerUser =
      role === UserRole.LOAN_OFFICER && sessionUserId
        ? await prisma.user.findUnique({ where: { id: sessionUserId } })
        : null;

    // Back-compat fallback (older UI sent loanOfficerName)
    if (!loanOfficerUser && loanOfficerName) {
      loanOfficerUser = await prisma.user.findFirst({
        where: { name: loanOfficerName },
      });
    }

    // Last resort fallback
    if (!loanOfficerUser) {
      loanOfficerUser = await prisma.user.findFirst({
        where: { role: UserRole.LOAN_OFFICER },
      });
    }

    if (!loanOfficerUser) {
      return { success: false, error: 'No loan officer user found' };
    }

    // Find or create loan
    let loan = await prisma.loan.findFirst({
      where: { loanNumber: arriveLoanNumber },
    });

    const targetStage =
      submissionType === 'QC' ? 'QC_REVIEW' : 'DISCLOSURES_PENDING';

    if (!loan) {
      loan = await prisma.loan.create({
        data: {
          loanNumber: arriveLoanNumber,
          borrowerName: `${borrowerFirstName} ${borrowerLastName}`.trim(),
          borrowerPhone: borrowerPhone?.trim() || null,
          borrowerEmail: borrowerEmail?.trim() || null,
          amount: Number(loanAmount || 0),
          loanOfficerId: loanOfficerUser.id,
          stage: targetStage,
        },
      });
    } else {
      // Update stage if it's currently INTAKE (Lead)
      if (loan.stage === 'INTAKE') {
        await prisma.loan.update({
          where: { id: loan.id },
          data: {
            stage: targetStage,
            borrowerPhone: borrowerPhone?.trim() || loan.borrowerPhone || null,
            borrowerEmail: borrowerEmail?.trim() || loan.borrowerEmail || null,
          },
        });
      }
    }

    const taskTitle =
      submissionType === 'QC'
        ? 'Submit for QC'
        : 'Submit for Disclosures';

    const assignedRole =
      submissionType === 'QC'
        ? UserRole.QC
        : UserRole.DISCLOSURE_SPECIALIST;

    const kind =
      submissionType === 'QC' ? TaskKind.SUBMIT_QC : TaskKind.SUBMIT_DISCLOSURES;

    const createdTask = await prisma.task.create({
      data: {
        loanId: loan.id,
        title: taskTitle,
        kind,
        description: notes || null,
        status: TaskStatus.PENDING,
        priority: TaskPriority.NORMAL,
        assignedRole,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    revalidatePath('/');
    return { success: true, taskId: createdTask.id, loanId: loan.id };
  } catch (error) {
    console.error('Failed to create submission task:', error);
    return { success: false, error: 'Failed to submit task' };
  }
}

export async function requestInfoFromLoanOfficer(taskId: string, message: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canRequest =
      role === UserRole.ADMIN ||
      role === UserRole.MANAGER ||
      role === UserRole.QC ||
      role === UserRole.DISCLOSURE_SPECIALIST;

    if (!canRequest) {
      return { success: false, error: 'Not authorized.' };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { loan: { select: { loanOfficerId: true } } },
    });
    if (!task) return { success: false, error: 'Task not found.' };

    await prisma.task.create({
      data: {
        loanId: task.loanId,
        title: 'LO: Needs Info',
        kind: TaskKind.LO_NEEDS_INFO,
        description: message || null,
        status: TaskStatus.PENDING,
        priority: TaskPriority.HIGH,
        assignedUserId: task.loan.loanOfficerId,
        assignedRole: UserRole.LOAN_OFFICER,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to request info:', error);
    return { success: false, error: 'Failed to request info.' };
  }
}

export async function deleteTask(taskId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    if (!role || (role !== UserRole.ADMIN && role !== UserRole.MANAGER)) {
      return { success: false, error: 'Not authorized to delete tasks.' };
    }

    await prisma.task.delete({
      where: { id: taskId },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: 'Failed to delete task.' };
  }
}
