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

type TaskBucketFilter = 'all' | 'new' | 'pending-lo' | 'completed';

function normalizeBucketFilter(value?: string): TaskBucketFilter | null {
  if (
    value === 'all' ||
    value === 'new' ||
    value === 'pending-lo' ||
    value === 'completed'
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
  
  const where: Prisma.TaskWhereInput = {};

  if (isLoanOfficer && userId) {
    where.OR = [
      { assignedUserId: userId },
      { loan: { loanOfficerId: userId } } // See tasks for their loans
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

function isSubmissionTaskForRole(role: UserRole, task: TaskRow) {
  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    return (
      task.kind === TaskKind.SUBMIT_DISCLOSURES ||
      (task.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
        task.title.toLowerCase().includes('disclosure'))
    );
  }
  if (role === UserRole.QC) {
    return (
      task.kind === TaskKind.SUBMIT_QC ||
      (task.assignedRole === UserRole.QC && task.title.toLowerCase().includes('qc'))
    );
  }
  return true;
}

function filterTasksByBucket(
  role: UserRole,
  tasks: TaskRow[],
  bucket: TaskBucketFilter
): TaskRow[] {
  if (bucket === 'all') return tasks;

  if (role === UserRole.DISCLOSURE_SPECIALIST || role === UserRole.QC) {
    const roleSubmissionTasks = tasks.filter((task) => isSubmissionTaskForRole(role, task));
    if (bucket === 'completed') {
      return roleSubmissionTasks.filter((task) => task.status === TaskStatus.COMPLETED);
    }
    if (bucket === 'pending-lo') {
      return roleSubmissionTasks.filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED &&
          (task.workflowState === TaskWorkflowState.WAITING_ON_LO ||
            task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)
      );
    }
    if (bucket === 'new') {
      return roleSubmissionTasks.filter(
        (task) =>
          task.status !== TaskStatus.COMPLETED &&
          task.workflowState !== TaskWorkflowState.WAITING_ON_LO &&
          task.workflowState !== TaskWorkflowState.WAITING_ON_LO_APPROVAL
      );
    }
  }

  if (role === UserRole.LOAN_OFFICER) {
    const loRoundTripTasks = tasks.filter((task) => task.kind === TaskKind.LO_NEEDS_INFO);
    if (bucket === 'completed') {
      return loRoundTripTasks.filter((task) => task.status === TaskStatus.COMPLETED);
    }
    if (bucket === 'pending-lo' || bucket === 'new') {
      return loRoundTripTasks.filter((task) => task.status !== TaskStatus.COMPLETED);
    }
  }

  if (bucket === 'completed') {
    return tasks.filter((task) => task.status === TaskStatus.COMPLETED);
  }
  return tasks.filter((task) => task.status !== TaskStatus.COMPLETED);
}

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const session = await getServerSession(authOptions);
  const sessionRole = (session?.user?.role as UserRole | undefined) || MOCK_USER.role;
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
  const tasks = filterTasksByBucket(sessionRole, allTasks, bucket);
  const newTasks = filterTasksByBucket(sessionRole, allTasks, 'new');
  const pendingLoTasks = filterTasksByBucket(sessionRole, allTasks, 'pending-lo');
  const completedTasks = filterTasksByBucket(sessionRole, allTasks, 'completed');
  const canDelete =
    sessionRole === UserRole.ADMIN || sessionRole === UserRole.MANAGER;
  const roleTaskSubtitle: Record<string, string> = {
    [UserRole.LOAN_OFFICER]: 'Manage your active requests and workflow tasks.',
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

  const showBuckets =
    sessionRole === UserRole.DISCLOSURE_SPECIALIST ||
    sessionRole === UserRole.QC ||
    sessionRole === UserRole.LOAN_OFFICER;

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
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div
            className={`rounded-xl border bg-slate-50/40 p-3 ${
              bucket === 'new' ? 'border-blue-300 ring-1 ring-blue-200' : 'border-slate-200'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">New</h2>
              <span className="app-count-badge">{newTasks.length}</span>
            </div>
            <TaskList tasks={newTasks} canDelete={canDelete} currentRole={sessionRole} />
          </div>
          <div
            className={`rounded-xl border bg-slate-50/40 p-3 ${
              bucket === 'pending-lo'
                ? 'border-blue-300 ring-1 ring-blue-200'
                : 'border-slate-200'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {sessionRole === UserRole.LOAN_OFFICER ? 'Pending Response' : 'Pending LO'}
              </h2>
              <span className="app-count-badge">{pendingLoTasks.length}</span>
            </div>
            <TaskList tasks={pendingLoTasks} canDelete={canDelete} currentRole={sessionRole} />
          </div>
          <div
            className={`rounded-xl border bg-slate-50/40 p-3 ${
              bucket === 'completed'
                ? 'border-blue-300 ring-1 ring-blue-200'
                : 'border-slate-200'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Completed</h2>
              <span className="app-count-badge">{completedTasks.length}</span>
            </div>
            <TaskList tasks={completedTasks} canDelete={canDelete} currentRole={sessionRole} />
          </div>
        </div>
      )}

      {!showBuckets && (
        <TaskList tasks={tasks} canDelete={canDelete} currentRole={sessionRole} />
      )}
    </DashboardShell>
  );
}
