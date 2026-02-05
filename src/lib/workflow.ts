import { prisma } from './prisma';
import { LoanStage, TaskStatus, UserRole } from '@prisma/client';

export async function changeLoanStage(loanId: string, newStage: LoanStage, userId: string) {
  // 1. Validate transition (optional: check if previous stage tasks are done)
  // For MVP, we just allow it but log it.

  // 2. Update Loan
  const loan = await prisma.loan.update({
    where: { id: loanId },
    data: {
      stage: newStage,
      auditLogs: {
        create: {
          userId,
          action: 'STAGE_CHANGED',
          details: `Moved to ${newStage}`,
        },
      },
    },
  });

  // 3. Generate Tasks for new stage
  await generateTasksForStage(loanId, newStage);

  return loan;
}

export async function generateTasksForStage(loanId: string, stage: LoanStage) {
  // Find templates for this stage
  const templates = await prisma.taskTemplate.findMany({
    where: { stage },
  });

  if (templates.length === 0) return;

  // Create tasks
  const tasksData = templates.map((t) => ({
    loanId,
    title: t.title,
    description: t.description,
    assignedRole: t.assignedRole,
    status: TaskStatus.PENDING,
    // Calculate due date based on offset
    dueDate: new Date(Date.now() + t.dueOffsetDays * 24 * 60 * 60 * 1000),
  }));

  await prisma.task.createMany({
    data: tasksData,
  });
}
