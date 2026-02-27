import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { TaskList } from '@/components/tasks/TaskList';
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
  | 'disclosures-sent-completed';

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
    value === 'disclosures-sent-completed'
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
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  loanOfficerApprovedAt: Date | null;
  submissionData: Prisma.JsonValue | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage: string;
  };
  assignedRole: UserRole | null;
  attachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
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
    where.OR = [
      { assignedUserId: userId },
      { loan: { loanOfficerId: userId } } // See tasks for their loans
    ];
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
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: {
      dueDate: 'asc', // Urgent first
    },
  });
  
  return tasks as TaskRow[];
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

type RoleBucket = {
  id: TaskBucketFilter;
  label: string;
  chipLabel: string;
  chipClassName: string;
  tasks: TaskRow[];
};

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
        id: 'new',
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
        id: 'pending-lo',
        label: 'Pending LO',
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
        id: 'completed',
        label: 'Completed',
        chipLabel: 'Completed',
        chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tasks: qcTasks.filter((task) => task.status === TaskStatus.COMPLETED),
      },
    ];
  }

  return [];
}

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const session = await getServerSession(authOptions);
  const sessionRole = normalizeRole(session?.user?.role);
  const sessionUser = {
    name: session?.user?.name || MOCK_USER.name,
    role: sessionRole,
    id: session?.user?.id || '',
  };
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawBucket = resolvedSearchParams?.bucket;
  const bucket =
    normalizeBucketFilter(
    typeof rawBucket === 'string' ? rawBucket : undefined
  ) || 'all';
  const allTasks = await getTasks(sessionRole, sessionUser.id);
  const roleBuckets = getRoleBuckets(sessionRole, allTasks);
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

      {showBuckets && (
        <div
          className="grid gap-3.5"
          style={{
            gridTemplateColumns: `repeat(${roleBuckets.length}, minmax(0, 1fr))`,
          }}
        >
          {roleBuckets.map((bucketConfig) => (
            <div
              key={bucketConfig.id}
                className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition-all hover:shadow-md ${
                activeBucket === bucketConfig.id
                  ? 'border-blue-300 ring-1 ring-blue-200'
                    : 'border-slate-200/80'
              }`}
            >
              <div className="mb-4 flex flex-col gap-3 border-b border-border/50 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                      <h2
                        className="text-sm font-extrabold leading-tight text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis"
                        title={bucketConfig.label}
                      >
                      {bucketConfig.label}
                    </h2>
                    <span
                      className={`mt-1.5 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm ${bucketConfig.chipClassName}`}
                    >
                      {bucketConfig.chipLabel}
                    </span>
                  </div>
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200/60">
                    {bucketConfig.tasks.length}
                  </span>
                </div>
                {sessionRole === UserRole.LOAN_OFFICER &&
                  bucketConfig.id === 'returned-to-disclosure' && (
                    <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <span
                        title="Blue = Approved sent back"
                        className="shrink-0 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700 shadow-sm"
                      >
                        Blue: Approved Back
                      </span>
                      <span
                        title="Orange = Revision sent back"
                        className="shrink-0 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 shadow-sm"
                      >
                        Orange: Revision Back
                      </span>
                    </div>
                  )}
              </div>
              <TaskList
                tasks={bucketConfig.tasks}
                canDelete={canDelete}
                currentRole={sessionRole}
              />
            </div>
          ))}
        </div>
      )}

      {!showBuckets && (
        <TaskList tasks={allTasks} canDelete={canDelete} currentRole={sessionRole} />
      )}
    </DashboardShell>
  );
}
