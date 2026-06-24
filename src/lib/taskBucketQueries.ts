import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/adminTiers';
import {
  DisclosureDecisionReason,
  Prisma,
  TaskAttachmentPurpose,
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';

export const TASK_BUCKET_PAGE_SIZE = 6;

export type TaskBucketSort =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_asc'
  | 'created_desc'
  | 'borrower_asc'
  | 'borrower_desc';

export type TaskBucketSectionId =
  | 'disclosure'
  | 'qc'
  | 'appraisal'
  | 'payoff'
  | 'title'
  | 'jr';

export type ManagerTaskBucketId =
  | 'new-disclosure'
  | 'waiting-missing'
  | 'waiting-approval'
  | 'lo-responded'
  | 'completed-disclosure'
  | 'qc-new'
  | 'qc-waiting-missing'
  | 'qc-lo-responded'
  | 'qc-completed-requests'
  | 'va-new-request'
  | 'jr-my-requests'
  | 'va-completed-requests'
  | 'va-title-started'
  | 'va-payoff-new'
  | 'va-payoff-started'
  | 'va-payoff-waiting-missing'
  | 'va-payoff-lo-responded'
  | 'va-payoff-completed'
  | 'va-appraisal-new'
  | 'va-appraisal-started'
  | 'va-appraisal-waiting-missing'
  | 'va-appraisal-lo-responded'
  | 'va-appraisal-completed';

export type TaskBucketCursor = {
  id: string;
} | null;

export type TaskBucketSpec = {
  id: ManagerTaskBucketId;
  sectionId: TaskBucketSectionId;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
  enableBatchDelete?: boolean;
  defaultSort: TaskBucketSort;
  where: Prisma.TaskWhereInput;
};

export type TaskBucketQueryRow = {
  id: string;
  loanId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
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
    secondaryLoanOfficer: {
      name: string;
    } | null;
  };
  assignedRole: UserRole | null;
  assignedUser: {
    id: string;
    name: string;
    role?: UserRole | null;
  } | null;
  attachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName: string | null;
    uploadedByRole: UserRole | null;
    sourceTaskKind: TaskKind | null;
    sourceTaskAssignedRole: UserRole | null;
    sourceTaskCreatedAt: Date | null;
  }[];
  timelineAttachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName: string | null;
    uploadedByRole: UserRole | null;
    sourceTaskKind: TaskKind | null;
    sourceTaskAssignedRole: UserRole | null;
    sourceTaskCreatedAt: Date | null;
  }[];
};

export type PagedTaskBucket = Omit<TaskBucketSpec, 'where' | 'defaultSort'> & {
  tasks: TaskBucketQueryRow[];
  totalCount: number;
  nextCursor: TaskBucketCursor;
  serverPagination: true;
  serverSort: TaskBucketSort;
};

function disclosureSubmissionWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { kind: TaskKind.SUBMIT_DISCLOSURES },
      {
        assignedRole: UserRole.DISCLOSURE_SPECIALIST,
        title: { contains: 'disclosure', mode: 'insensitive' },
      },
    ],
  };
}

function qcSubmissionWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { kind: TaskKind.SUBMIT_QC },
      {
        assignedRole: UserRole.QC,
        title: { contains: 'qc', mode: 'insensitive' },
      },
    ],
  };
}

function andWhere(...clauses: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput {
  return { AND: clauses.filter((clause) => Object.keys(clause).length > 0) };
}

const notCompleted = { status: { not: TaskStatus.COMPLETED } } satisfies Prisma.TaskWhereInput;

export const MANAGER_TASK_BUCKET_SPECS: TaskBucketSpec[] = [
  {
    id: 'new-disclosure',
    sectionId: 'disclosure',
    label: 'New Disclosure Requests',
    chipLabel: 'New',
    chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
    defaultSort: 'created_asc',
    where: andWhere(disclosureSubmissionWhere(), notCompleted, {
      workflowState: TaskWorkflowState.NONE,
    }),
  },
  {
    id: 'waiting-missing',
    sectionId: 'disclosure',
    label: 'Waiting Missing/Incomplete',
    chipLabel: 'Pending LO',
    chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    defaultSort: 'created_asc',
    where: andWhere(disclosureSubmissionWhere(), notCompleted, {
      workflowState: TaskWorkflowState.WAITING_ON_LO,
    }),
  },
  {
    id: 'lo-responded',
    sectionId: 'disclosure',
    label: 'LO Responded (Review)',
    chipLabel: 'Needs Review',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    defaultSort: 'created_asc',
    where: andWhere(disclosureSubmissionWhere(), notCompleted, {
      workflowState: TaskWorkflowState.READY_TO_COMPLETE,
    }),
  },
  {
    id: 'waiting-approval',
    sectionId: 'disclosure',
    label: 'Waiting for Approval',
    chipLabel: 'Awaiting Approval',
    chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    defaultSort: 'created_asc',
    where: andWhere(disclosureSubmissionWhere(), notCompleted, {
      workflowState: TaskWorkflowState.WAITING_ON_LO_APPROVAL,
    }),
  },
  {
    id: 'completed-disclosure',
    sectionId: 'disclosure',
    label: 'Completed Disclosure Requests',
    chipLabel: 'Completed',
    chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    isCompleted: true,
    defaultSort: 'updated_desc',
    where: andWhere(disclosureSubmissionWhere(), { status: TaskStatus.COMPLETED }),
  },
  {
    id: 'qc-new',
    sectionId: 'qc',
    label: 'New QC Requests',
    chipLabel: 'New',
    chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
    defaultSort: 'created_asc',
    where: andWhere(qcSubmissionWhere(), notCompleted, {
      workflowState: TaskWorkflowState.NONE,
    }),
  },
  {
    id: 'qc-waiting-missing',
    sectionId: 'qc',
    label: 'Waiting Missing/Incomplete',
    chipLabel: 'Pending LO',
    chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    defaultSort: 'created_asc',
    where: andWhere(qcSubmissionWhere(), notCompleted, {
      OR: [
        { workflowState: TaskWorkflowState.WAITING_ON_LO },
        { workflowState: TaskWorkflowState.WAITING_ON_LO_APPROVAL },
      ],
    }),
  },
  {
    id: 'qc-lo-responded',
    sectionId: 'qc',
    label: 'LO Responded (Review)',
    chipLabel: 'Needs Review',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    defaultSort: 'created_asc',
    where: andWhere(qcSubmissionWhere(), notCompleted, {
      workflowState: TaskWorkflowState.READY_TO_COMPLETE,
    }),
  },
  {
    id: 'qc-completed-requests',
    sectionId: 'qc',
    label: 'Completed QC Requests',
    chipLabel: 'Completed',
    chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    isCompleted: true,
    defaultSort: 'updated_desc',
    where: andWhere(qcSubmissionWhere(), { status: TaskStatus.COMPLETED }),
  },
  {
    id: 'va-appraisal-new',
    sectionId: 'appraisal',
    label: 'New Appraisal Specialist Requests',
    chipLabel: 'New',
    chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: {
      kind: TaskKind.VA_APPRAISAL,
      status: TaskStatus.PENDING,
      workflowState: TaskWorkflowState.NONE,
      assignedUserId: null,
    },
  },
  {
    id: 'va-appraisal-started',
    sectionId: 'appraisal',
    label: 'Started / Ordered Appraisal Requests',
    chipLabel: 'In Progress',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere(
      { kind: TaskKind.VA_APPRAISAL },
      notCompleted,
      { workflowState: TaskWorkflowState.NONE },
      {
        NOT: {
          status: TaskStatus.PENDING,
          assignedUserId: null,
        },
      }
    ),
  },
  {
    id: 'va-appraisal-waiting-missing',
    sectionId: 'appraisal',
    label: 'Waiting Missing/Incomplete',
    chipLabel: 'Pending LO',
    chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere({ kind: TaskKind.VA_APPRAISAL }, notCompleted, {
      workflowState: TaskWorkflowState.WAITING_ON_LO,
    }),
  },
  {
    id: 'va-appraisal-lo-responded',
    sectionId: 'appraisal',
    label: 'LO Responded (Review)',
    chipLabel: 'Needs Review',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere({ kind: TaskKind.VA_APPRAISAL }, notCompleted, {
      workflowState: TaskWorkflowState.READY_TO_COMPLETE,
    }),
  },
  {
    id: 'va-appraisal-completed',
    sectionId: 'appraisal',
    label: 'Completed Appraisal Specialist Requests',
    chipLabel: 'Completed',
    chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    isCompleted: true,
    enableBatchDelete: true,
    defaultSort: 'updated_desc',
    where: { kind: TaskKind.VA_APPRAISAL, status: TaskStatus.COMPLETED },
  },
  {
    id: 'va-payoff-new',
    sectionId: 'payoff',
    label: 'New VA Payoff Requests',
    chipLabel: 'New',
    chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: {
      kind: TaskKind.VA_PAYOFF,
      status: TaskStatus.PENDING,
      workflowState: TaskWorkflowState.NONE,
      assignedUserId: null,
    },
  },
  {
    id: 'va-payoff-started',
    sectionId: 'payoff',
    label: 'Started / Ordered VA Payoff Requests',
    chipLabel: 'In Progress',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere(
      { kind: TaskKind.VA_PAYOFF },
      notCompleted,
      { workflowState: TaskWorkflowState.NONE },
      {
        NOT: {
          status: TaskStatus.PENDING,
          assignedUserId: null,
        },
      }
    ),
  },
  {
    id: 'va-payoff-waiting-missing',
    sectionId: 'payoff',
    label: 'Waiting Missing/Incomplete',
    chipLabel: 'Pending LO',
    chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere({ kind: TaskKind.VA_PAYOFF }, notCompleted, {
      workflowState: TaskWorkflowState.WAITING_ON_LO,
    }),
  },
  {
    id: 'va-payoff-lo-responded',
    sectionId: 'payoff',
    label: 'LO Responded (Review)',
    chipLabel: 'Needs Review',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere({ kind: TaskKind.VA_PAYOFF }, notCompleted, {
      workflowState: TaskWorkflowState.READY_TO_COMPLETE,
    }),
  },
  {
    id: 'va-payoff-completed',
    sectionId: 'payoff',
    label: 'Completed VA Payoff Requests',
    chipLabel: 'Completed',
    chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    isCompleted: true,
    enableBatchDelete: true,
    defaultSort: 'updated_desc',
    where: { kind: TaskKind.VA_PAYOFF, status: TaskStatus.COMPLETED },
  },
  {
    id: 'va-new-request',
    sectionId: 'title',
    label: 'New VA Title Requests',
    chipLabel: 'New',
    chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: {
      kind: TaskKind.VA_TITLE,
      status: TaskStatus.PENDING,
      workflowState: TaskWorkflowState.NONE,
      assignedUserId: null,
    },
  },
  {
    id: 'va-title-started',
    sectionId: 'title',
    label: 'Started / Ordered VA Title Requests',
    chipLabel: 'In Progress',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere(
      { kind: TaskKind.VA_TITLE },
      notCompleted,
      {
        NOT: {
          status: TaskStatus.PENDING,
          workflowState: TaskWorkflowState.NONE,
          assignedUserId: null,
        },
      }
    ),
  },
  {
    id: 'va-completed-requests',
    sectionId: 'title',
    label: 'Completed VA Title Requests',
    chipLabel: 'Completed',
    chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    isCompleted: true,
    enableBatchDelete: true,
    defaultSort: 'updated_desc',
    where: { kind: TaskKind.VA_TITLE, status: TaskStatus.COMPLETED },
  },
  {
    id: 'va-new-request',
    sectionId: 'jr',
    label: 'New JR Processor Requests',
    chipLabel: 'New',
    chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: {
      kind: TaskKind.VA_HOI,
      status: TaskStatus.PENDING,
      workflowState: TaskWorkflowState.NONE,
      assignedUserId: null,
    },
  },
  {
    id: 'jr-my-requests',
    sectionId: 'jr',
    label: 'Assigned Requests',
    chipLabel: 'In Progress',
    chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    enableBatchDelete: true,
    defaultSort: 'created_asc',
    where: andWhere(
      { kind: TaskKind.VA_HOI },
      notCompleted,
      {
        NOT: {
          status: TaskStatus.PENDING,
          workflowState: TaskWorkflowState.NONE,
          assignedUserId: null,
        },
      }
    ),
  },
  {
    id: 'va-completed-requests',
    sectionId: 'jr',
    label: 'Completed JR Processor Requests',
    chipLabel: 'Completed',
    chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    isCompleted: true,
    enableBatchDelete: true,
    defaultSort: 'updated_desc',
    where: { kind: TaskKind.VA_HOI, status: TaskStatus.COMPLETED },
  },
];

export function canUsePagedTaskBuckets(role: UserRole) {
  return role === UserRole.MANAGER || isAdmin(role);
}

export function getManagerTaskBucketSpec(
  bucketId: string,
  sectionId?: string
): TaskBucketSpec | null {
  return (
    MANAGER_TASK_BUCKET_SPECS.find(
      (spec) => spec.id === bucketId && (!sectionId || spec.sectionId === sectionId)
    ) || null
  );
}

function applySearch(where: Prisma.TaskWhereInput, search?: string): Prisma.TaskWhereInput {
  const query = search?.trim();
  if (!query) return where;
  const searchWhere: Prisma.TaskWhereInput = {
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
      {
        loan: {
          is: {
            borrowerName: { contains: query, mode: 'insensitive' },
          },
        },
      },
      {
        loan: {
          is: {
            loanNumber: { contains: query, mode: 'insensitive' },
          },
        },
      },
      {
        loan: {
          is: {
            loanOfficer: {
              is: { name: { contains: query, mode: 'insensitive' } },
            },
          },
        },
      },
      {
        loan: {
          is: {
            secondaryLoanOfficer: {
              is: { name: { contains: query, mode: 'insensitive' } },
            },
          },
        },
      },
      {
        assignedUser: {
          is: { name: { contains: query, mode: 'insensitive' } },
        },
      },
    ],
  };
  return andWhere(where, searchWhere);
}

function getOrderBy(sort: TaskBucketSort): Prisma.TaskOrderByWithRelationInput[] {
  if (sort === 'updated_asc') return [{ updatedAt: 'asc' }, { id: 'asc' }];
  if (sort === 'updated_desc') return [{ updatedAt: 'desc' }, { id: 'desc' }];
  if (sort === 'created_desc') return [{ createdAt: 'desc' }, { id: 'desc' }];
  if (sort === 'borrower_asc') {
    return [{ loan: { borrowerName: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }];
  }
  if (sort === 'borrower_desc') {
    return [{ loan: { borrowerName: 'desc' } }, { createdAt: 'asc' }, { id: 'asc' }];
  }
  return [{ createdAt: 'asc' }, { id: 'asc' }];
}

async function hydrateTaskRows(
  tasks: Array<
    Prisma.TaskGetPayload<{
      include: typeof TASK_BUCKET_QUERY_INCLUDE;
    }>
  >,
  role: UserRole
): Promise<TaskBucketQueryRow[]> {
  const includeCrossTaskTimelineAttachments =
    (role === UserRole.LOAN_OFFICER || role === UserRole.MANAGER || isAdmin(role)) &&
    tasks.some(
      (task) =>
        task.kind === TaskKind.VA_TITLE ||
        task.kind === TaskKind.VA_PAYOFF ||
        task.kind === TaskKind.VA_APPRAISAL ||
        task.kind === TaskKind.VA_HOI ||
        task.parentTaskId
    ) &&
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
      ? await prisma.task.findMany({
          where: {
            OR: [
              { id: { in: taskIds } },
              { parentTaskId: { in: taskIds } },
              ...(parentTaskIds.length > 0
                ? [{ id: { in: parentTaskIds } }, { parentTaskId: { in: parentTaskIds } }]
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
    includeCrossTaskTimelineAttachments && allRelatedIds.length > 0
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
      TaskBucketQueryRow['timelineAttachments'][number]
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

    return {
      ...task,
      priority: task.priority,
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
      timelineAttachments: Array.from(timelineAttachmentsMap.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
    };
  });
}

const TASK_BUCKET_QUERY_INCLUDE = {
  loan: {
    select: {
      loanNumber: true,
      borrowerName: true,
      stage: true,
      loanOfficer: {
        select: {
          name: true,
        },
      },
      secondaryLoanOfficer: {
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
} satisfies Prisma.TaskInclude;

export async function queryTaskBucketPage({
  bucketId,
  sectionId,
  role,
  cursor,
  pageSize = TASK_BUCKET_PAGE_SIZE,
  search,
  globalSearch,
  bucketSearch,
  sort,
}: {
  bucketId: string;
  sectionId?: string;
  role: UserRole;
  cursor?: TaskBucketCursor;
  pageSize?: number;
  search?: string;
  globalSearch?: string;
  bucketSearch?: string;
  sort?: TaskBucketSort;
}) {
  if (!canUsePagedTaskBuckets(role)) {
    throw new Error('Role cannot use paged task buckets.');
  }
  const spec = getManagerTaskBucketSpec(bucketId, sectionId);
  if (!spec) {
    throw new Error('Unknown task bucket.');
  }
  const safePageSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const effectiveSort = sort || spec.defaultSort;
  const where = applySearch(
    applySearch(spec.where, globalSearch ?? search),
    bucketSearch
  );
  const orderBy = getOrderBy(effectiveSort);

  const [totalCount, rawTasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: TASK_BUCKET_QUERY_INCLUDE,
      orderBy,
      take: safePageSize + 1,
      ...(cursor?.id ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    }),
  ]);

  const hasNextPage = rawTasks.length > safePageSize;
  const pageTasks = hasNextPage ? rawTasks.slice(0, safePageSize) : rawTasks;
  const tasks = await hydrateTaskRows(pageTasks, role);
  const lastTask = pageTasks[pageTasks.length - 1];

  return {
    spec,
    tasks,
    totalCount,
    nextCursor: hasNextPage && lastTask ? { id: lastTask.id } : null,
    serverSort: effectiveSort,
  };
}

export async function queryInitialManagerTaskBuckets(role: UserRole) {
  const buckets = await Promise.all(
    MANAGER_TASK_BUCKET_SPECS.map((spec) =>
      queryTaskBucketPage({
        bucketId: spec.id,
        sectionId: spec.sectionId,
        role,
        pageSize: TASK_BUCKET_PAGE_SIZE,
        sort: spec.defaultSort,
      })
    )
  );

  const bySection = new Map<TaskBucketSectionId, PagedTaskBucket[]>();
  for (const bucket of buckets) {
    const sectionBuckets = bySection.get(bucket.spec.sectionId) || [];
    sectionBuckets.push({
      id: bucket.spec.id,
      sectionId: bucket.spec.sectionId,
      label: bucket.spec.label,
      chipLabel: bucket.spec.chipLabel,
      chipClassName: bucket.spec.chipClassName,
      isCompleted: bucket.spec.isCompleted,
      enableBatchDelete: bucket.spec.enableBatchDelete,
      tasks: bucket.tasks,
      totalCount: bucket.totalCount,
      nextCursor: bucket.nextCursor,
      serverPagination: true,
      serverSort: bucket.serverSort,
    });
    bySection.set(bucket.spec.sectionId, sectionBuckets);
  }

  return {
    disclosureBuckets: bySection.get('disclosure') || [],
    qcBuckets: bySection.get('qc') || [],
    vaAppraisalBuckets: bySection.get('appraisal') || [],
    vaPayoffBuckets: bySection.get('payoff') || [],
    vaTitleBuckets: bySection.get('title') || [],
    vaHoiBuckets: bySection.get('jr') || [],
  };
}

export async function queryManagerLoVaProgressSeedTasks(role: UserRole) {
  if (!canUsePagedTaskBuckets(role)) return [];
  const rawTasks = await prisma.task.findMany({
    where: {
      kind: {
        in: [TaskKind.VA_TITLE, TaskKind.VA_PAYOFF, TaskKind.VA_APPRAISAL, TaskKind.VA_HOI],
      },
      status: TaskStatus.COMPLETED,
    },
    include: TASK_BUCKET_QUERY_INCLUDE,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 120,
  });
  return hydrateTaskRows(rawTasks, role);
}
