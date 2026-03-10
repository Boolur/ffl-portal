import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { TaskList } from '@/components/tasks/TaskList';
import { TaskBucketsBoard } from '@/components/tasks/TaskBucketsBoard';
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
import { ClipboardCheck, ShieldCheck } from 'lucide-react';

// In a real app, we'd get the current user from the session
const MOCK_USER = {
  id: 'mock-user-id',
  name: 'Sarah Disclosure',
  role: UserRole.DISCLOSURE_SPECIALIST,
};

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
  | 'qc-completed-requests';

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
    value === 'qc-completed-requests'
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
  // Fetch tasks assigned to this role OR specifically to this user
  // For LOs, we want to see tasks for loans they own OR tasks assigned to them
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;
  
  const where: Prisma.TaskWhereInput = isAdminOrManager ? {} : {};

  if (isAdminOrManager) {
    // no-op: managers/admins can review all queues
  } else if (isLoanOfficer && userId) {
    // Strict LO scope: only tasks tied to loans they own.
    where.OR = [{ loan: { loanOfficerId: userId } }];
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
  } else {
    where.OR = [
      { assignedRole: role as UserRole },
      // { assignedUserId: userId } // Add this later for other roles
    ];
  }

  const tasks = await prisma.task.findMany({
    where,
    include: {
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          stage: true, // Include stage
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
  });

  const taskIds = tasks.map((task) => task.id);
  const parentTaskIds = Array.from(
    new Set(
      tasks
        .map((task) => task.parentTaskId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const relatedTasks =
    taskIds.length > 0
      ? await prisma.task.findMany({
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
        })
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
    allRelatedIds.length > 0
      ? await prisma.taskAttachment.findMany({
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
        })
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
      chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
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
        chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
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
        chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
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
        chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
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
        tasks: qcTasks.filter((task) => task.status === TaskStatus.COMPLETED),
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

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const session = await getServerSession(authOptions);
  const sessionRole = normalizeRole(session?.user?.activeRole || session?.user?.role);
  const sessionUser = {
    name: session?.user?.name || MOCK_USER.name,
    role: sessionRole,
    id: session?.user?.id || '',
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
  const loPilotFlagRows =
    sessionRole === UserRole.LOAN_OFFICER && sessionUser.id
      ? await prisma.$queryRaw<Array<{ loQcTwoRowPilot: boolean }>>`
          SELECT "loQcTwoRowPilot"
          FROM "User"
          WHERE id = ${sessionUser.id}
          LIMIT 1
        `
      : [];
  const isLoTwoRowPilot =
    sessionRole === UserRole.LOAN_OFFICER &&
    Boolean(loPilotFlagRows[0]?.loQcTwoRowPilot);
  const roleBuckets = getRoleBuckets(sessionRole, allTasks);
  const dualDeskRows = isLoTwoRowPilot
    ? getLoPilotRows(allTasks)
    : sessionRole === UserRole.MANAGER
    ? getManagerDeskRows(allTasks)
    : null;
  const isDualDeskMode = Boolean(dualDeskRows);
  const canDelete =
    sessionRole === UserRole.ADMIN || sessionRole === UserRole.MANAGER;
  const roleTaskSubtitle: Record<string, string> = {
    [UserRole.LOAN_OFFICER]:
      'Manage submitted requests, complete LO actions, and track returns sent back to Disclosure.',
    [UserRole.ADMIN]: 'Manage and clean up tasks across all teams.',
    [UserRole.MANAGER]: 'Oversee team workload and remove invalid requests.',
    [UserRole.DISCLOSURE_SPECIALIST]: 'Work disclosure tasks by due date and status.',
    [UserRole.VA]: 'Track support tasks and progress them to completion.',
    [UserRole.VA_TITLE]: 'Complete Title tasks and upload proof before finishing.',
    [UserRole.VA_HOI]: 'Complete HOI tasks and upload proof before finishing.',
    [UserRole.VA_PAYOFF]: 'Complete Payoff tasks and upload proof before finishing.',
    [UserRole.VA_APPRAISAL]: 'Complete Appraisal tasks and upload proof before finishing.',
    [UserRole.QC]: 'Review and complete quality control tasks.',
    [UserRole.PROCESSOR_JR]: 'Handle processing tasks and keep files moving.',
    [UserRole.PROCESSOR_SR]: 'Handle advanced processing tasks and escalations.',
  };

  const showBuckets = roleBuckets.length > 0;
  const activeBucket = roleBuckets.find((b) => b.id === bucket)?.id || null;

  return (
    <DashboardShell user={sessionUser}>
      <div className="flex items-center justify-between app-page-header">
        <div>
          <h1 className="app-page-title">Tasks</h1>
          <p className="app-page-subtitle">
            {roleTaskSubtitle[sessionRole] || 'View and manage task status across your workflow.'}
          </p>
        </div>
        <div className="flex space-x-3">
          <span className="app-count-badge">
            {allTasks.length} Total Tasks
          </span>
        </div>
      </div>

      {isDualDeskMode && dualDeskRows && (
        <div className="space-y-5">
          <section>
            <div className="mb-2">
              <h2 className="inline-flex items-center gap-3 text-xl font-bold text-slate-900">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                  <ClipboardCheck className="h-5 w-5" />
                </span>
                Disclosure Requests
              </h2>
            </div>
            <TaskBucketsBoard
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
          </section>
          <section>
            <div className="mb-2">
              <h2 className="inline-flex items-center gap-3 text-xl font-bold text-slate-900">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                QC Requests
              </h2>
            </div>
            <TaskBucketsBoard
              buckets={dualDeskRows.qcBuckets}
              activeBucketId={
                dualDeskRows.qcBuckets.find((b) => b.id === bucket)?.id || null
              }
              canDelete={canDelete}
              currentRole={sessionRole}
              currentUserId={sessionUser.id}
              initialFocusedTaskId={focusedTaskId}
              bucketScrollMode="fixed"
              fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
            />
          </section>
        </div>
      )}

      {!isDualDeskMode && showBuckets && (
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

      {!isDualDeskMode && !showBuckets && (
        <TaskList
          tasks={allTasks}
          canDelete={canDelete}
          currentRole={sessionRole}
          currentUserId={sessionUser.id}
          initialFocusedTaskId={focusedTaskId}
        />
      )}
    </DashboardShell>
  );
}

