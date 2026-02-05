'use server';

import { prisma } from '@/lib/prisma';
import { TaskPriority, TaskStatus, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus) {
  try {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
        completedAt: newStatus === 'COMPLETED' ? new Date() : null,
      },
    });
    
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
  loanOfficerName: string;
  borrowerFirstName: string;
  borrowerLastName: string;
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
      arriveLoanNumber,
      loanAmount,
      notes,
    } = payload;

    // Resolve loan officer (fallback to any LO user)
    const loanOfficerUser =
      (await prisma.user.findFirst({
        where: { name: loanOfficerName },
      })) ||
      (await prisma.user.findFirst({
        where: { role: UserRole.LOAN_OFFICER },
      }));

    if (!loanOfficerUser) {
      return { success: false, error: 'No loan officer user found' };
    }

    // Find or create loan
    let loan = await prisma.loan.findFirst({
      where: { loanNumber: arriveLoanNumber },
    });

    if (!loan) {
      loan = await prisma.loan.create({
        data: {
          loanNumber: arriveLoanNumber,
          borrowerName: `${borrowerFirstName} ${borrowerLastName}`.trim(),
          amount: Number(loanAmount || 0),
          loanOfficerId: loanOfficerUser.id,
        },
      });
    }

    const taskTitle =
      submissionType === 'QC'
        ? 'Submit for QC'
        : 'Submit for Disclosures';

    const assignedRole =
      submissionType === 'QC'
        ? UserRole.QC
        : UserRole.DISCLOSURE_SPECIALIST;

    await prisma.task.create({
      data: {
        loanId: loan.id,
        title: taskTitle,
        description: notes || null,
        status: TaskStatus.PENDING,
        priority: TaskPriority.NORMAL,
        assignedRole,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to create submission task:', error);
    return { success: false, error: 'Failed to submit task' };
  }
}
