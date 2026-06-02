import {
  TaskAttachmentPurpose,
  TaskKind,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPerfMetric } from '@/lib/perf';
import type { RawTaskWithIncludes } from '@/lib/tasks/taskInclude';
import type { TaskRow } from '@/lib/tasks/types';
import { shouldIncludeTimelineAttachments } from '@/lib/tasks/taskScope';

export async function hydrateTaskRows(
  tasks: RawTaskWithIncludes[],
  role: UserRole
): Promise<TaskRow[]> {
  const jrLoanIds =
    role === UserRole.PROCESSOR_JR
      ? Array.from(
          new Set(
            tasks
              .filter((task) => task.kind === TaskKind.VA_HOI)
              .map((task) => task.loanId)
              .filter((loanId): loanId is string => Boolean(loanId))
          )
        )
      : [];

  const vaCompletionByLoanId = new Map<
    string,
    { titleDone: boolean; payoffDone: boolean; appraisalDone: boolean }
  >();

  if (jrLoanIds.length > 0) {
    const jrRelatedVaTasks = await withPerfMetric(
      'query.tasks.findMany.jrVaSummary',
      () =>
        prisma.task.findMany({
          where: {
            loanId: { in: jrLoanIds },
            kind: {
              in: [TaskKind.VA_TITLE, TaskKind.VA_PAYOFF, TaskKind.VA_APPRAISAL],
            },
          },
          select: {
            loanId: true,
            kind: true,
            status: true,
          },
        }),
      { role, loanCount: jrLoanIds.length }
    );

    for (const row of jrRelatedVaTasks) {
      const existing = vaCompletionByLoanId.get(row.loanId) || {
        titleDone: false,
        payoffDone: false,
        appraisalDone: false,
      };
      if (row.kind === TaskKind.VA_TITLE && row.status === TaskStatus.COMPLETED) {
        existing.titleDone = true;
      } else if (row.kind === TaskKind.VA_PAYOFF && row.status === TaskStatus.COMPLETED) {
        existing.payoffDone = true;
      } else if (row.kind === TaskKind.VA_APPRAISAL && row.status === TaskStatus.COMPLETED) {
        existing.appraisalDone = true;
      }
      vaCompletionByLoanId.set(row.loanId, existing);
    }
  }

  const includeCrossTaskTimelineAttachments = shouldIncludeTimelineAttachments(role, tasks);

  const taskIds = tasks.map((task) => task.id);
  const parentTaskIds = Array.from(
    new Set(tasks.map((task) => task.parentTaskId).filter((id): id is string => Boolean(id)))
  );

  const relatedTasks =
    includeCrossTaskTimelineAttachments && taskIds.length > 0
      ? await withPerfMetric(
          'query.tasks.findMany.related',
          () =>
            prisma.task.findMany({
              where: {
                OR: [
                  { id: { in: taskIds } },
                  { parentTaskId: { in: taskIds } },
                  ...(parentTaskIds.length > 0
                    ? [
                        { id: { in: parentTaskIds } },
                        { parentTaskId: { in: parentTaskIds } },
                      ]
                    : []),
                ],
              },
              select: {
                id: true,
                parentTaskId: true,
              },
            }),
          { role, taskCount: taskIds.length }
        )
      : [];

  const childrenByParent = new Map<string, string[]>();
  for (const rel of relatedTasks) {
    if (!rel.parentTaskId) continue;
    const existing = childrenByParent.get(rel.parentTaskId) || [];
    existing.push(rel.id);
    childrenByParent.set(rel.parentTaskId, existing);
  }

  const allRelatedIds = Array.from(new Set(relatedTasks.map((task) => task.id)));
  const timelineAttachmentsRows =
    includeCrossTaskTimelineAttachments && allRelatedIds.length > 0
      ? await withPerfMetric(
          'query.taskAttachments.findMany.timeline',
          () =>
            prisma.taskAttachment.findMany({
              where: {
                taskId: { in: allRelatedIds },
              },
              select: {
                id: true,
                taskId: true,
                filename: true,
                purpose: true,
                storagePath: true,
                createdAt: true,
                task: {
                  select: {
                    kind: true,
                    assignedRole: true,
                    createdAt: true,
                  },
                },
                uploadedBy: {
                  select: {
                    name: true,
                    role: true,
                  },
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            }),
          { role, relatedIds: allRelatedIds.length }
        )
      : [];

  const attachmentsByTaskId = new Map<string, typeof timelineAttachmentsRows>();
  for (const att of timelineAttachmentsRows) {
    const existing = attachmentsByTaskId.get(att.taskId) || [];
    existing.push(att);
    attachmentsByTaskId.set(att.taskId, existing);
  }

  return tasks.map((task) => {
    const parentId = task.parentTaskId || task.id;
    const chainIds = [parentId, ...(childrenByParent.get(parentId) || [])];

    const timelineAttachmentsMap = new Map<
      string,
      {
        id: string;
        filename: string;
        purpose: TaskAttachmentPurpose;
        createdAt: Date;
        uploadedByName: string | null;
        uploadedByRole: UserRole | null;
        sourceTaskKind: TaskKind | null;
        sourceTaskAssignedRole: UserRole | null;
        sourceTaskCreatedAt: Date | null;
      }
    >();

    for (const chainTaskId of chainIds) {
      const chainAttachments = attachmentsByTaskId.get(chainTaskId) || [];
      for (const att of chainAttachments) {
        const dedupeKey = `${att.storagePath}::${att.purpose}`;
        if (timelineAttachmentsMap.has(dedupeKey)) continue;
        timelineAttachmentsMap.set(dedupeKey, {
          id: att.id,
          filename: att.filename,
          purpose: att.purpose,
          createdAt: att.createdAt,
          uploadedByName: att.uploadedBy?.name || null,
          uploadedByRole: att.uploadedBy?.role || null,
          sourceTaskKind: att.task?.kind || null,
          sourceTaskAssignedRole: att.task?.assignedRole || null,
          sourceTaskCreatedAt: att.task?.createdAt || null,
        });
      }
    }

    const timelineAttachments = Array.from(timelineAttachmentsMap.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return {
      id: task.id,
      loanId: task.loanId,
      title: task.title,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      dueDate: task.dueDate,
      kind: task.kind,
      workflowState: task.workflowState,
      disclosureReason: task.disclosureReason,
      parentTaskId: task.parentTaskId,
      parentTask: task.parentTask,
      loanOfficerApprovedAt: task.loanOfficerApprovedAt,
      submissionData: task.submissionData,
      loan: task.loan,
      assignedRole: task.assignedRole,
      assignedUser: task.assignedUser
        ? { id: task.assignedUser.id, name: task.assignedUser.name }
        : null,
      attachments: task.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        purpose: att.purpose,
        createdAt: att.createdAt,
        uploadedByName: att.uploadedBy?.name || null,
        uploadedByRole: att.uploadedBy?.role || null,
        sourceTaskKind: task.kind,
        sourceTaskAssignedRole: task.assignedRole,
        sourceTaskCreatedAt: task.createdAt,
      })),
      timelineAttachments,
      vaCompletionSummary:
        task.kind === TaskKind.VA_HOI
          ? vaCompletionByLoanId.get(task.loanId) || {
              titleDone: false,
              payoffDone: false,
              appraisalDone: false,
            }
          : undefined,
    };
  });
}
