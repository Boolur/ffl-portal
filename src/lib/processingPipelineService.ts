import { Prisma, UserRole } from '@prisma/client';
import {
  parseOptionalBoolean,
  parseOptionalMoney,
} from './processingPipeline';
import { isInHouseProcessingAssignmentGroup } from './processingRouting';

type TransactionClient = Prisma.TransactionClient;

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export async function resolveSeniorProcessorForGroup(
  tx: TransactionClient,
  assignmentGroup: unknown,
) {
  const group = optionalString(assignmentGroup);
  if (!group || !isInHouseProcessingAssignmentGroup(group)) {
    return { seniorProcessorId: null, resolution: 'NOT_IN_HOUSE' as const };
  }

  const matches = await tx.user.findMany({
    where: {
      active: true,
      processingAssignmentGroups: { has: group },
      OR: [
        { role: UserRole.PROCESSOR_SR },
        { roles: { has: UserRole.PROCESSOR_SR } },
      ],
    },
    select: { id: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 2,
  });

  if (matches.length === 1) {
    return { seniorProcessorId: matches[0].id, resolution: 'MATCHED' as const };
  }
  return {
    seniorProcessorId: null,
    resolution: matches.length > 1 ? 'AMBIGUOUS' as const : 'MISSING' as const,
  };
}

export async function upsertProcessingPipelineForCompletedTask(
  tx: TransactionClient,
  input: {
    taskId: string;
    actorId: string;
    completedAt?: Date;
  },
) {
  const task = await tx.task.findUnique({
    where: { id: input.taskId },
    include: {
      loan: {
        select: {
          id: true,
          program: true,
        },
      },
    },
  });
  if (!task || task.kind !== 'SUBMIT_PROCESSING') return null;

  const data = asObject(task.submissionData);
  const assignmentGroup = optionalString(data.processingAssignmentGroup);
  const senior = await resolveSeniorProcessorForGroup(tx, assignmentGroup);
  const appraisalWaiver = parseOptionalBoolean(data.appraisalWaiver);
  const completedAt = input.completedAt ?? new Date();
  const pipelineData = {
    sourceTaskId: task.id,
    seniorProcessorId: senior.seniorProcessorId,
    juniorProcessorId: task.assignedUserId || input.actorId,
    assignmentGroup,
    dateAssigned: completedAt,
    appraisalNeeded: appraisalWaiver === null ? null : !appraisalWaiver,
    appraisalNotes: optionalString(data.appraisalNotes),
    loanType: optionalString(data.loanType) || task.loan.program,
    propertyState:
      optionalString(data.propertyState) ||
      optionalString(data.state),
    lender: optionalString(data.investor) || optionalString(data.lender),
    projectedRevenue: parseOptionalMoney(data.projectedRevenue),
  };

  const existing = await tx.processingPipelineLoan.findUnique({
    where: { loanId: task.loanId },
    select: { id: true },
  });
  const row = existing
    ? await tx.processingPipelineLoan.update({
        where: { id: existing.id },
        data: pipelineData,
      })
    : await tx.processingPipelineLoan.create({
        data: {
          loanId: task.loanId,
          ...pipelineData,
        },
      });

  await tx.auditLog.create({
    data: {
      loanId: task.loanId,
      userId: input.actorId,
      action: existing ? 'PROCESSING_PIPELINE_REFRESHED' : 'PROCESSING_PIPELINE_CREATED',
      details: JSON.stringify({
        processingPipelineLoanId: row.id,
        sourceTaskId: task.id,
        assignmentGroup,
        seniorProcessorId: senior.seniorProcessorId,
        assignmentResolution: senior.resolution,
      }),
    },
  });

  return row;
}
