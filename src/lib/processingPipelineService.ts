import {
  LeadStatus,
  NotificationOutboxEventType,
  Prisma,
  type ProcessingPipelineLoan,
  UserRole,
} from '@prisma/client';
import {
  getProcessingPipelineLockedDefaults,
  getProcessingPipelineLeadSource,
  parseOptionalBoolean,
  parseOptionalMoney,
} from './processingPipeline';
import {
  getProcessingAssignmentSeniorNames,
  isInHouseProcessingAssignmentGroup,
} from './processingRouting';
import { syncLeadStatusForLoan } from './leadPipelineSync';
import { preserveAriveManagedFields } from './ariveSyncState';
import { ARIVE_SYNC_PILOT } from './ariveSyncTypes';

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
    return { seniorProcessorId: matches[0].id, resolution: 'MATCHED_BY_GROUP' as const };
  }
  if (matches.length > 1) {
    return { seniorProcessorId: null, resolution: 'AMBIGUOUS' as const };
  }

  const selectedProcessorNames = getProcessingAssignmentSeniorNames(group);
  const nameMatches = await tx.user.findMany({
    where: {
      active: true,
      name: { in: selectedProcessorNames, mode: 'insensitive' },
      OR: [
        { role: UserRole.PROCESSOR_SR },
        { roles: { has: UserRole.PROCESSOR_SR } },
      ],
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2,
  });
  if (nameMatches.length === 1) {
    return { seniorProcessorId: nameMatches[0].id, resolution: 'MATCHED_BY_NAME' as const };
  }
  return {
    seniorProcessorId: null,
    resolution: nameMatches.length > 1 ? 'AMBIGUOUS' as const : 'MISSING' as const,
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
  const explicitlyNeeded = parseOptionalBoolean(data.appraisalNeeded);
  const appraisalWaiver = parseOptionalBoolean(data.appraisalWaiver);
  const completedAt = input.completedAt ?? new Date();
  const processingMethod = optionalString(data.processingMethod);
  const lender = optionalString(data.investor) || optionalString(data.lender);
  const loanProgram = optionalString(data.loanProgram);
  const submittedRevenue = parseOptionalMoney(data.projectedRevenue);
  const lockedDefaults = getProcessingPipelineLockedDefaults(lender, processingMethod);
  const lockedPipelineData = lockedDefaults
    ? {
        ...lockedDefaults.values,
        payoffOrderedAt: null,
        payoffExpiresAt: null,
        hoiOrderedAt: null,
        ...(lockedDefaults.kind === 'SPECIAL_LENDER'
          ? {
              cdWarningStartsAt: null,
              rateLockExpiresAt: null,
              rateLockConfirmedAt: completedAt,
              rateLockRequestedAt: null,
              rateLockRequestedById: null,
            }
          : {}),
      }
    : {};
  const pipelineData = {
    sourceTaskId: task.id,
    seniorProcessorId: senior.seniorProcessorId,
    juniorProcessorId: task.assignedUserId || input.actorId,
    assignmentGroup,
    processingMethod,
    dateAssigned: completedAt,
    appraisalNeeded:
      explicitlyNeeded ?? (appraisalWaiver === null ? null : !appraisalWaiver),
    appraisalNotes: optionalString(data.appraisalNotes),
    loanType: optionalString(data.loanType),
    propertyState:
      optionalString(data.propertyState) ||
      optionalString(data.state),
    lender,
    leadSource: getProcessingPipelineLeadSource(data.leadSource, data.leadVendor),
    projectedRevenue: submittedRevenue,
    ...lockedPipelineData,
  };

  if (loanProgram && loanProgram !== task.loan.program) {
    await tx.loan.update({
      where: { id: task.loan.id },
      data: { program: loanProgram },
    });
  }

  let existing = await tx.processingPipelineLoan.findUnique({
    where: { loanId: task.loanId },
    select: { id: true, finalRevenue: true },
  });
  let syncedCurrent: ProcessingPipelineLoan | null = null;
  if (existing && task.loanId === ARIVE_SYNC_PILOT.loanId) {
    // The caller may already hold the submission-package lock. Keep the same
    // package -> pipeline lock order as the inbound worker, then use fresh values.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${existing.id}`}))`;
    const current = await tx.processingPipelineLoan.findUnique({ where: { id: existing.id } });
    if (!current || current.loanId !== task.loanId) {
      throw new Error('The processing file changed. Reopen the task before completing it.');
    }
    existing = current;
    const sync = await tx.arivePipelineSync.findUnique({
      where: { pipelineId: current.id },
      select: { enabled: true },
    });
    if (sync?.enabled) syncedCurrent = current;
  }
  const updateData: Prisma.ProcessingPipelineLoanUncheckedUpdateInput = {
    ...pipelineData,
    ...(existing?.finalRevenue == null ? { finalRevenue: submittedRevenue } : {}),
  };
  if (syncedCurrent) {
    await preserveAriveManagedFields(tx, syncedCurrent, updateData);
    updateData.version = { increment: 1 };
  }
  const row = existing
    ? await tx.processingPipelineLoan.update({
        where: { id: existing.id, ...(syncedCurrent ? { version: syncedCurrent.version } : {}) },
        data: updateData,
      })
    : await tx.processingPipelineLoan.create({
        data: {
          loanId: task.loanId,
          ...pipelineData,
          finalRevenue: submittedRevenue,
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
        processingMethod,
        seniorProcessorId: senior.seniorProcessorId,
        assignmentResolution: senior.resolution,
      }),
    },
  });

  await tx.notificationOutbox.upsert({
    where: {
      idempotencyKey: `processing-submitted:${row.id}:${task.id}`,
    },
    update: {},
    create: {
      eventType: NotificationOutboxEventType.PROCESSING_LIFECYCLE,
      idempotencyKey: `processing-submitted:${row.id}:${task.id}`,
      payload: {
        processingPipelineLoanId: row.id,
        event: 'SUBMITTED',
        eventLabel: existing
          ? 'Processing submission refreshed'
          : 'Submitted to Processing',
        actorName: 'Processing team member',
        summary: existing
          ? 'The processing file was refreshed from its completed submission.'
          : 'A new file entered the processing pipeline.',
      },
    },
  });

  await syncLeadStatusForLoan(tx, {
    loanId: task.loanId,
    taskId: task.id,
    nextStatus: LeadStatus.SUBMITTED_PROCESSING,
    actorId: input.actorId,
    source: existing
      ? 'processing-pipeline-refreshed'
      : 'processing-pipeline-created',
  });

  return row;
}
