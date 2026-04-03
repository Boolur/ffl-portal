import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { TaskList } from '@/components/tasks/TaskList';
import { TaskBucketsBoard } from '@/components/tasks/TaskBucketsBoard';
import { TaskDeskSection } from '@/components/tasks/TaskDeskSection';
import { TasksRouteSyncGate } from '@/components/tasks/TasksRouteSyncGate';
import { LoVaBorrowerProgressList } from '@/components/loanOfficer/LoVaBorrowerProgressList';
import { buildLoVaBorrowerProgress, isLoVaPilotUser } from '@/lib/loVaProgress';
import { buildLoanOfficerTaskWhere } from '@/lib/loanOfficerVisibility';
import {
  DisclosureDecisionReason,
  TaskAttachmentPurpose,
  Prisma,
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ClipboardCheck, FileCheck2, Home, Landmark, ShieldCheck } from 'lucide-react';
import { startPerfTimer, withPerfMetric } from '@/lib/perf';

// In a real app, we'd get the current user from the session
const MOCK_USER = {
  id: 'mock-user-id',
  name: 'Sarah Disclosure',
  role: UserRole.DISCLOSURE_SPECIALIST,
};

const VA_TASK_KINDS: TaskKind[] = [
  TaskKind.VA_TITLE,
  TaskKind.VA_PAYOFF,
  TaskKind.VA_APPRAISAL,
];

function normalizeRole(role?: string | null): UserRole {
  if (!role) return MOCK_USER.role;
  const normalized = role.trim().toUpperCase();
  const roles = Object.values(UserRole) as string[];
  if (!roles.includes(normalized)) return MOCK_USER.role;
  return normalized as UserRole;
}

type TaskBucketFilter =
  | 'all'
  | 'new'
  | 'pending-lo'
  | 'completed'
  | 'new-disclosure'
  | 'waiting-missing'
  | 'waiting-approval'
  | 'lo-responded'
  | 'completed-disclosure'
  | 'submitted-disclosures'
  | 'action-required'
  | 'returned-to-disclosure'
  | 'disclosures-sent-completed'
  | 'submitted-qc'
  | 'action-required-qc'
  | 'returned-to-qc'
  | 'qc-completed'
  | 'qc-new'
  | 'qc-waiting-missing'
  | 'qc-lo-responded'
  | 'qc-completed-requests'
  | 'va-new-request'
  | 'va-completed-requests'
  | 'va-payoff-new'
  | 'va-payoff-waiting-missing'
  | 'va-payoff-lo-responded'
  | 'va-payoff-completed'
  | 'va-appraisal-new'
  | 'va-appraisal-waiting-missing'
  | 'va-appraisal-lo-responded'
  | 'va-appraisal-completed';

function normalizeBucketFilter(value?: string): TaskBucketFilter | null {
  if (
    value === 'all' ||
    value === 'new' ||
    value === 'pending-lo' ||
    value === 'completed' ||
    value === 'new-disclosure' ||
    value === 'waiting-missing' ||
    value === 'waiting-approval' ||
    value === 'lo-responded' ||
    value === 'completed-disclosure' ||
    value === 'submitted-disclosures' ||
    value === 'action-required' ||
    value === 'returned-to-disclosure' ||
    value === 'disclosures-sent-completed' ||
    value === 'submitted-qc' ||
    value === 'action-required-qc' ||
    value === 'returned-to-qc' ||
    value === 'qc-completed' ||
    value === 'qc-new' ||
    value === 'qc-waiting-missing' ||
    value === 'qc-lo-responded' ||
    value === 'qc-completed-requests' ||
    value === 'va-new-request' ||
    value === 'va-completed-requests' ||
    value === 'va-payoff-new' ||
    value === 'va-payoff-waiting-missing' ||
    value === 'va-payoff-lo-responded' ||
    value === 'va-payoff-completed' ||
    value === 'va-appraisal-new' ||
    value === 'va-appraisal-waiting-missing' ||
    value === 'va-appraisal-lo-responded' ||
    value === 'va-appraisal-completed'
  ) {
    return value;
  }
  return null;
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  updatedAt: Date;
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  parentTask: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
    title: string;
    submissionData: Prisma.JsonValue | null;
  } | null;
  loanOfficerApprovedAt: Date | null;
  submissionData: Prisma.JsonValue | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage: string;
    loanOfficer: {
      name: string;
    } | null;
  };
  assignedRole: UserRole | null;
  assignedUser: {
    id: string;
    name: string;
  } | null;
  attachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName: string | null;
    uploadedByRole: UserRole | null;
  }[];
  timelineAttachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName: string | null;
    uploadedByRole: UserRole | null;
  }[];
};

async function getTasks(role: UserRole, userId?: string): Promise<TaskRow[]> {
  const endPerf = startPerfTimer('page.tasks.getTasks.total', {
    role,
  });
  // Fetch tasks assigned to this role OR specifically to this user
  // For LOs, we want to see tasks for loans they own OR tasks assigned to them
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isLoanOfficerAssistant = role === UserRole.LOA;
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isGenericVa = role === UserRole.VA;
  
  const where: Prisma.TaskWhereInput = isAdminOrManager ? {} : {};

  if (isAdminOrManager || isLoanOfficerAssistant) {
    // no-op: managers/admins can review all queues
  } else if (isLoanOfficer && userId) {
    // LO scope includes primary, secondary, and submitter fallback visibility.
    Object.assign(where, buildLoanOfficerTaskWhere(userId));
  } else if (role === UserRole.DISCLOSURE_SPECIALIST) {
    where.OR = [
      { assignedRole: role as UserRole },
      { kind: TaskKind.SUBMIT_DISCLOSURES },
    ];
  } else if (role === UserRole.QC) {
    where.OR = [
      { assignedRole: role as UserRole },
      { kind: TaskKind.SUBMIT_QC },
    ];
  } else if (isGenericVa) {
    where.OR = [
      { kind: { in: VA_TASK_KINDS } },
      ...(userId ? [{ assignedUserId: userId }] : []),
      { assignedRole: UserRole.VA },
    ];
  } else if (role === UserRole.PROCESSOR_JR) {
    // Backward compatibility: preserve HOI visibility regardless of assignment role drift.
    where.OR = [{ assignedRole: UserRole.PROCESSOR_JR }, { kind: TaskKind.VA_HOI }];
  } else {
    where.OR = [
      { assignedRole: role as UserRole },
      // { assignedUserId: userId } // Add this later for other roles
    ];
  }

  const tasks = await withPerfMetric(
    'query.tasks.findMany.primary',
    () =>
      prisma.task.findMany({
    where,
    include: {
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          stage: true, // Include stage
          loanOfficer: {
            select: {
              name: true,
            },
          },
        },
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          purpose: true,
          createdAt: true,
          uploadedBy: {
            select: {
              name: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      assignedUser: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      parentTask: {
        select: {
          kind: true,
          assignedRole: true,
          title: true,
          submissionData: true,
        },
      },
    },
    orderBy: {
      dueDate: 'asc', // Urgent first
    },
      }),
    {
      role,
      hasUserId: Boolean(userId),
    }
  );

  const hasTimelineRelevantTasks = tasks.some(
    (task) =>
      task.kind === TaskKind.VA_TITLE ||
      task.kind === TaskKind.VA_PAYOFF ||
      task.kind === TaskKind.VA_APPRAISAL ||
      task.kind === TaskKind.VA_HOI ||
      task.parentTaskId
  );
  const includeCrossTaskTimelineAttachments =
    (isLoanOfficer || isAdminOrManager) &&
    hasTimelineRelevantTasks &&
    process.env.TASK_TIMELINE_EAGER !== 'false';

  const taskIds = tasks.map((task) => task.id);
  const parentTaskIds = Array.from(
    new Set(
      tasks
        .map((task) => task.parentTaskId)
        .filter((id): id is string => Boolean(id))
    )
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
          {
            role,
            taskCount: taskIds.length,
          }
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
          {
            role,
            relatedIds: allRelatedIds.length,
          }
        )
      : [];

  const attachmentsByTaskId = new Map<string, typeof timelineAttachmentsRows>();
  for (const att of timelineAttachmentsRows) {
    const existing = attachmentsByTaskId.get(att.taskId) || [];
    existing.push(att);
    attachmentsByTaskId.set(att.taskId, existing);
  }

  const hydratedTasks = tasks.map((task) => {
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
      }
    >();

    for (const chainTaskId of chainIds) {
      const chainAttachments = attachmentsByTaskId.get(chainTaskId) || [];
      for (const att of chainAttachments) {
        // Parent/child workflow tasks can carry mirrored attachment rows.
        // Dedupe by storagePath so one bucket transition shows one attachment event.
        const dedupeKey = `${att.storagePath}::${att.purpose}`;
        if (timelineAttachmentsMap.has(dedupeKey)) continue;
        timelineAttachmentsMap.set(dedupeKey, {
          id: att.id,
          filename: att.filename,
          purpose: att.purpose,
          createdAt: att.createdAt,
          uploadedByName: att.uploadedBy?.name || null,
          uploadedByRole: att.uploadedBy?.role || null,
        });
      }
    }

    const timelineAttachments = Array.from(timelineAttachmentsMap.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return {
      ...task,
      attachments: task.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        purpose: att.purpose,
        createdAt: att.createdAt,
        uploadedByName: att.uploadedBy?.name || null,
        uploadedByRole: att.uploadedBy?.role || null,
      })),
      timelineAttachments,
    };
  }) as TaskRow[];

  endPerf({
    taskCount: hydratedTasks.length,
  });
  return hydratedTasks;
}

function isDisclosureSubmissionTask(task: TaskRow) {
  return (
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    (task.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
      task.title.toLowerCase().includes('disclosure'))
  );
}

function isQcSubmissionTask(task: TaskRow) {
  return (
    task.kind === TaskKind.SUBMIT_QC ||
    (task.assignedRole === UserRole.QC && task.title.toLowerCase().includes('qc'))
  );
}

function isLoResponseTask(task: TaskRow) {
  return task.kind === TaskKind.LO_NEEDS_INFO;
}

function isDisclosureSubmissionTaskRef(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    (task.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
      task.title.toLowerCase().includes('disclosure'))
  );
}

function isQcSubmissionTaskRef(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_QC ||
    (task.assignedRole === UserRole.QC && task.title.toLowerCase().includes('qc'))
  );
}

type RoleBucket = {
  id: TaskBucketFilter;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
  tasks: TaskRow[];
};

function getLoPilotRows(allTasks: TaskRow[]) {
  const disclosureTasks = allTasks.filter(isDisclosureSubmissionTask);
  const qcTasks = allTasks.filter(isQcSubmissionTask);
  const loResponseTasks = allTasks.filter(isLoResponseTask);

  const disclosureActionRequired = loResponseTasks.filter((task) => {
    if (!task.parentTask) return true;
    return isDisclosureSubmissionTaskRef(task.parentTask);
  });
  const qcActionRequired = loResponseTasks.filter((task) => {
    if (!task.parentTask) return false;
    return isQcSubmissionTaskRef(task.parentTask);
  });

  const disclosureBuckets: RoleBucket[] = [
    {
      id: 'submitted-disclosures',
      label: 'Submitted for Disclosures',
      chipLabel: 'Submitted',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      tasks: disclosureTasks.filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.NONE
      ),
    },
    {
      id: 'action-required',
      label: 'Action Required (Approve Figures / Missing Info)',
      chipLabel: 'Action Required',
      chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      tasks: disclosureActionRequired.filter(
        (task) => task.status !== TaskStatus.COMPLETED
      ),
    },
    {
      id: 'returned-to-disclosure',
      label: 'Returned to Disclosure',
      chipLabel: 'Tracking',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      tasks: disclosureTasks.filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
      ),
    },
    {
      id: 'disclosures-sent-completed',
      label: 'Disclosures Sent / Completed',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      tasks: disclosureTasks.filter((task) => task.status === TaskStatus.COMPLETED),
    },
  ];

  const qcBuckets: RoleBucket[] = [
    {
      id: 'submitted-qc',
      label: 'Submitted for QC',
      chipLabel: 'Submitted',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      tasks: qcTasks.filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.NONE
      ),
    },
    {
      id: 'action-required-qc',
      label: 'Action Required (QC Info / Approval)',
      chipLabel: 'Action Required',
      chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      tasks: qcActionRequired.filter((task) => task.status !== TaskStatus.COMPLETED),
    },
    {
      id: 'returned-to-qc',
      label: 'Returned to QC',
      chipLabel: 'Tracking',
      chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
      tasks: qcTasks.filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
      ),
    },
    {
      id: 'qc-completed',
      label: 'QC Sent / Completed',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      isCompleted: true,
      tasks: qcTasks.filter((task) => task.status === TaskStatus.COMPLETED),
    },
  ];

  return { disclosureBuckets, qcBuckets };
}

function getRoleBuckets(role: UserRole, allTasks: TaskRow[]): RoleBucket[] {
  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    const disclosureTasks = allTasks.filter(isDisclosureSubmissionTask);
    return [
      {
        id: 'new-disclosure',
        label: 'New Disclosure Requests',
        chipLabel: 'New',
        chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
        tasks: disclosureTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.NONE
        ),
      },
      {
        id: 'waiting-missing',
        label: 'Waiting Missing/Incomplete',
        chipLabel: 'Pending LO',
        chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
        tasks: disclosureTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.WAITING_ON_LO
        ),
      },
      {
        id: 'lo-responded',
        label: 'LO Responded (Review)',
        chipLabel: 'Needs Review',
        chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
        tasks: disclosureTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
        ),
      },
      {
        id: 'waiting-approval',
        label: 'Waiting for Approval',
        chipLabel: 'Awaiting Approval',
        chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
        tasks: disclosureTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL
        ),
      },
      {
        id: 'completed-disclosure',
        label: 'Completed Disclosure Requests',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: disclosureTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  if (role === UserRole.LOAN_OFFICER) {
    const disclosureTasks = allTasks.filter(isDisclosureSubmissionTask);
    const loResponseTasks = allTasks.filter(isLoResponseTask);
    return [
      {
        id: 'submitted-disclosures',
        label: 'Submitted for Disclosures',
        chipLabel: 'Submitted',
        chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
        tasks: disclosureTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.NONE
        ),
      },
      {
        id: 'action-required',
        label: 'Action Required (Approve Figures / Missing Info)',
        chipLabel: 'Action Required',
        chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
        tasks: loResponseTasks.filter(
          (task) => task.status !== TaskStatus.COMPLETED
        ),
      },
      {
        id: 'returned-to-disclosure',
        label: 'Returned to Disclosure',
        chipLabel: 'Tracking',
        chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
        tasks: disclosureTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
        ),
      },
      {
        id: 'disclosures-sent-completed',
        label: 'Disclosures Sent / Completed',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: disclosureTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  if (role === UserRole.QC) {
    const qcTasks = allTasks.filter(isQcSubmissionTask);
    return [
      {
        id: 'qc-new',
        label: 'New QC Requests',
        chipLabel: 'New',
        chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
        tasks: qcTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.NONE
        ),
      },
      {
        id: 'qc-waiting-missing',
        label: 'Waiting Missing/Incomplete',
        chipLabel: 'Pending LO',
        chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
        tasks: qcTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            (task.workflowState === TaskWorkflowState.WAITING_ON_LO ||
              task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)
        ),
      },
      {
        id: 'qc-lo-responded',
        label: 'LO Responded (Review)',
        chipLabel: 'Needs Review',
        chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
        tasks: qcTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
        ),
      },
      {
        id: 'qc-completed-requests',
        label: 'Completed QC Requests',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: qcTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  if (role === UserRole.VA_TITLE) {
    const vaTitleTasks = allTasks.filter((task) => task.kind === TaskKind.VA_TITLE);
    return [
      {
        id: 'va-new-request',
        label: 'New VA Title Requests',
        chipLabel: 'New',
        chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
        tasks: vaTitleTasks.filter((task) => task.status !== TaskStatus.COMPLETED),
      },
      {
        id: 'va-completed-requests',
        label: 'Completed VA Title Requests',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: vaTitleTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  if (role === UserRole.PROCESSOR_JR) {
    const vaHoiTasks = allTasks.filter((task) => task.kind === TaskKind.VA_HOI);
    return [
      {
        id: 'va-new-request',
        label: 'New JR Processor Requests',
        chipLabel: 'New',
        chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
        tasks: vaHoiTasks.filter((task) => task.status !== TaskStatus.COMPLETED),
      },
      {
        id: 'va-completed-requests',
        label: 'Completed JR Processor Requests',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: vaHoiTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  if (role === UserRole.VA_PAYOFF) {
    const vaPayoffTasks = allTasks.filter((task) => task.kind === TaskKind.VA_PAYOFF);
    return [
      {
        id: 'va-payoff-new',
        label: 'New VA Payoff Requests',
        chipLabel: 'New',
        chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
        tasks: vaPayoffTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.NONE
        ),
      },
      {
        id: 'va-payoff-waiting-missing',
        label: 'Waiting Missing/Incomplete',
        chipLabel: 'Pending LO',
        chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
        tasks: vaPayoffTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.WAITING_ON_LO
        ),
      },
      {
        id: 'va-payoff-lo-responded',
        label: 'LO Responded (Review)',
        chipLabel: 'Needs Review',
        chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
        tasks: vaPayoffTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
        ),
      },
      {
        id: 'va-payoff-completed',
        label: 'Completed VA Payoff Requests',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: vaPayoffTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  if (role === UserRole.VA_APPRAISAL) {
    const vaAppraisalTasks = allTasks.filter((task) => task.kind === TaskKind.VA_APPRAISAL);
    return [
      {
        id: 'va-appraisal-new',
        label: 'New VA Appraisal Requests',
        chipLabel: 'New',
        chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
        tasks: vaAppraisalTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.NONE
        ),
      },
      {
        id: 'va-appraisal-waiting-missing',
        label: 'Waiting Missing/Incomplete',
        chipLabel: 'Pending LO',
        chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
        tasks: vaAppraisalTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.WAITING_ON_LO
        ),
      },
      {
        id: 'va-appraisal-lo-responded',
        label: 'LO Responded (Review)',
        chipLabel: 'Needs Review',
        chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
        tasks: vaAppraisalTasks.filter(
          (task) =>
            task.status !== TaskStatus.COMPLETED &&
            task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
        ),
      },
      {
        id: 'va-appraisal-completed',
        label: 'Completed VA Appraisal Requests',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        isCompleted: true,
        tasks: vaAppraisalTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  return [];
}

function getManagerDeskRows(allTasks: TaskRow[]) {
  return {
    disclosureBuckets: getRoleBuckets(UserRole.DISCLOSURE_SPECIALIST, allTasks),
    qcBuckets: getRoleBuckets(UserRole.QC, allTasks),
  };
}

function getManagerVaDeskRows(allTasks: TaskRow[]) {
  return {
    vaTitleBuckets: getRoleBuckets(UserRole.VA_TITLE, allTasks),
    vaHoiBuckets: getRoleBuckets(UserRole.PROCESSOR_JR, allTasks),
    vaPayoffBuckets: getRoleBuckets(UserRole.VA_PAYOFF, allTasks),
    vaAppraisalBuckets: getRoleBuckets(UserRole.VA_APPRAISAL, allTasks),
  };
}

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const endPerf = startPerfTimer('page.tasks.render.total');
  const session = await getServerSession(authOptions);
  const sessionRole = normalizeRole(session?.user?.activeRole || session?.user?.role);
  const sessionUser = {
    name: session?.user?.name || MOCK_USER.name,
    role: sessionRole,
    id: session?.user?.id || '',
    email: session?.user?.email || '',
  };
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawBucket = resolvedSearchParams?.bucket;
  const rawTaskId = resolvedSearchParams?.taskId;
  const focusedTaskId =
    typeof rawTaskId === 'string' && rawTaskId.trim().length > 0
      ? rawTaskId.trim()
      : null;
  const bucket =
    normalizeBucketFilter(
    typeof rawBucket === 'string' ? rawBucket : undefined
  ) || 'all';
  const allTasks = await getTasks(sessionRole, sessionUser.id);
  const roleBuckets = getRoleBuckets(sessionRole, allTasks);
  const dualDeskRows = sessionRole === UserRole.LOAN_OFFICER
    ? getLoPilotRows(allTasks)
    : sessionRole === UserRole.LOA
    ? getLoPilotRows(allTasks)
    : sessionRole === UserRole.MANAGER
    ? getManagerDeskRows(allTasks)
    : null;
  const managerVaRows =
    sessionRole === UserRole.MANAGER || sessionRole === UserRole.VA
      ? getManagerVaDeskRows(allTasks)
      : null;
  const showLoVaPilot =
    sessionRole === UserRole.LOAN_OFFICER &&
    isLoVaPilotUser({
      role: sessionRole,
      email: sessionUser.email,
      name: sessionUser.name,
    });
  const loVaProgressItems = showLoVaPilot ? buildLoVaBorrowerProgress(allTasks) : [];
  const loaVaProgressItems =
    sessionRole === UserRole.LOA ? buildLoVaBorrowerProgress(allTasks) : [];
  const managerLoVaProgressItems =
    sessionRole === UserRole.MANAGER ? buildLoVaBorrowerProgress(allTasks) : [];
  const isDualDeskMode = Boolean(dualDeskRows);
  const canDelete = sessionRole === UserRole.ADMIN;
  const roleTaskSubtitle: Record<string, string> = {
    [UserRole.LOAN_OFFICER]:
      'Manage submitted requests, complete LO actions, and track returns sent back to Disclosure.',
    [UserRole.LOA]:
      'Submit requests and monitor all loan officer workflows across Disclosure, QC, VA, and JR desks.',
    [UserRole.ADMIN]: 'Manage and clean up tasks across all teams.',
    [UserRole.MANAGER]:
      'Oversee Disclosure, QC, and VA queues with full desk-level actions.',
    [UserRole.DISCLOSURE_SPECIALIST]: 'Work disclosure tasks by due date and status.',
    [UserRole.VA]:
      'Work all VA queues (Title, Payoff, Appraisal) without manager-level disclosure/QC views.',
    [UserRole.VA_TITLE]: 'Complete Title tasks and upload proof before finishing.',
    [UserRole.VA_PAYOFF]: 'Complete Payoff tasks and upload proof before finishing.',
    [UserRole.VA_APPRAISAL]: 'Complete Appraisal tasks and upload proof before finishing.',
    [UserRole.QC]: 'Review and complete quality control tasks.',
    [UserRole.PROCESSOR_JR]: 'Complete JR Processor requests and upload proof before finishing.',
    [UserRole.PROCESSOR_SR]: 'Handle advanced processing tasks and escalations.',
  };

  const showBuckets = roleBuckets.length > 0;
  const activeBucket = roleBuckets.find((b) => b.id === bucket)?.id || null;
  const taskPageSubtitle =
    sessionRole === UserRole.VA
      ? ''
      : roleTaskSubtitle[sessionRole] || 'View and manage task status across your workflow.';

  const pageOutput = (
    <DashboardShell user={sessionUser}>
      <TasksRouteSyncGate>
        <div className="flex items-center justify-between app-page-header">
        <div>
          <h1 className="app-page-title">Tasks</h1>
          {taskPageSubtitle && (
            <p className="app-page-subtitle">
              {taskPageSubtitle}
            </p>
          )}
        </div>
        <div className="flex space-x-3">
          <span className="app-count-badge">
            {allTasks.length} Total Tasks
          </span>
        </div>
      </div>

      {isDualDeskMode && dualDeskRows && (
        <div className="space-y-5">
          <TaskDeskSection
            title="Disclosure Requests"
            icon={<ClipboardCheck className="h-5 w-5" />}
            iconClassName="bg-blue-50 text-blue-600 ring-blue-100"
            buckets={dualDeskRows.disclosureBuckets}
            activeBucketId={
              dualDeskRows.disclosureBuckets.find((b) => b.id === bucket)?.id || null
            }
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            initialFocusedTaskId={focusedTaskId}
            bucketScrollMode="fixed"
            fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
          />
          <TaskDeskSection
            title="QC Requests"
            icon={<ShieldCheck className="h-5 w-5" />}
            iconClassName="bg-violet-50 text-violet-600 ring-violet-100"
            buckets={dualDeskRows.qcBuckets}
            activeBucketId={dualDeskRows.qcBuckets.find((b) => b.id === bucket)?.id || null}
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            initialFocusedTaskId={focusedTaskId}
            bucketScrollMode="fixed"
            fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
          />
          {sessionRole === UserRole.LOAN_OFFICER && showLoVaPilot && (
            <LoVaBorrowerProgressList items={loVaProgressItems} currentRole={sessionRole} />
          )}
          {sessionRole === UserRole.LOA && (
            <LoVaBorrowerProgressList items={loaVaProgressItems} currentRole={sessionRole} />
          )}
          {sessionRole === UserRole.MANAGER && managerVaRows && (
            <>
              <TaskDeskSection
                title="Appraisal Requests"
                icon={<ShieldCheck className="h-5 w-5" />}
                iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                buckets={managerVaRows.vaAppraisalBuckets}
                activeBucketId={
                  managerVaRows.vaAppraisalBuckets.find((b) => b.id === bucket)?.id || null
                }
                canDelete={canDelete}
                currentRole={sessionRole}
                currentUserId={sessionUser.id}
                initialFocusedTaskId={focusedTaskId}
                bucketScrollMode="fixed"
                fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                enableBatchDelete
              />
              <TaskDeskSection
                title="Payoff Requests"
                icon={<Landmark className="h-5 w-5" />}
                iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                buckets={managerVaRows.vaPayoffBuckets}
                activeBucketId={
                  managerVaRows.vaPayoffBuckets.find((b) => b.id === bucket)?.id || null
                }
                canDelete={canDelete}
                currentRole={sessionRole}
                currentUserId={sessionUser.id}
                initialFocusedTaskId={focusedTaskId}
                bucketScrollMode="fixed"
                fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                enableBatchDelete
              />
              <TaskDeskSection
                title="Title Requests"
                icon={<FileCheck2 className="h-5 w-5" />}
                iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                buckets={managerVaRows.vaTitleBuckets}
                activeBucketId={managerVaRows.vaTitleBuckets.find((b) => b.id === bucket)?.id || null}
                canDelete={canDelete}
                currentRole={sessionRole}
                currentUserId={sessionUser.id}
                initialFocusedTaskId={focusedTaskId}
                bucketScrollMode="fixed"
                fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                enableBatchDelete
              />
              <TaskDeskSection
                title="JR Processor Requests"
                icon={<Home className="h-5 w-5" />}
                iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                buckets={managerVaRows.vaHoiBuckets}
                activeBucketId={managerVaRows.vaHoiBuckets.find((b) => b.id === bucket)?.id || null}
                canDelete={canDelete}
                currentRole={sessionRole}
                currentUserId={sessionUser.id}
                initialFocusedTaskId={focusedTaskId}
                bucketScrollMode="fixed"
                fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                enableBatchDelete
              />
              <LoVaBorrowerProgressList
                items={managerLoVaProgressItems}
                mode="completed_only"
                className="pt-1"
                currentRole={sessionRole}
              />
            </>
          )}
        </div>
      )}

      {!isDualDeskMode && sessionRole === UserRole.VA && managerVaRows && (
        <div className="space-y-5">
          <TaskDeskSection
            title="Appraisals"
            icon={<ShieldCheck className="h-5 w-5" />}
            iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
            buckets={managerVaRows.vaAppraisalBuckets}
            activeBucketId={
              managerVaRows.vaAppraisalBuckets.find((b) => b.id === bucket)?.id || null
            }
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            initialFocusedTaskId={focusedTaskId}
            bucketScrollMode="fixed"
            fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
          />
          <TaskDeskSection
            title="Payoffs"
            icon={<Landmark className="h-5 w-5" />}
            iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
            buckets={managerVaRows.vaPayoffBuckets}
            activeBucketId={
              managerVaRows.vaPayoffBuckets.find((b) => b.id === bucket)?.id || null
            }
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            initialFocusedTaskId={focusedTaskId}
            bucketScrollMode="fixed"
            fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
          />
          <TaskDeskSection
            title="Title"
            icon={<FileCheck2 className="h-5 w-5" />}
            iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
            buckets={managerVaRows.vaTitleBuckets}
            activeBucketId={managerVaRows.vaTitleBuckets.find((b) => b.id === bucket)?.id || null}
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            initialFocusedTaskId={focusedTaskId}
            bucketScrollMode="fixed"
            fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
          />
        </div>
      )}

      {!isDualDeskMode && sessionRole !== UserRole.VA && showBuckets && (
        <TaskBucketsBoard
          buckets={roleBuckets}
          activeBucketId={activeBucket}
          canDelete={canDelete}
          currentRole={sessionRole}
          currentUserId={sessionUser.id}
          initialFocusedTaskId={focusedTaskId}
          bucketScrollMode="auto"
        />
      )}

        {!isDualDeskMode && sessionRole !== UserRole.VA && !showBuckets && (
          <TaskList
            tasks={allTasks}
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            initialFocusedTaskId={focusedTaskId}
          />
        )}
      </TasksRouteSyncGate>
    </DashboardShell>
  );
  endPerf({
    role: sessionRole,
    taskCount: allTasks.length,
  });
  return pageOutput;
}

