import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { TaskList } from '@/components/tasks/TaskList';
import {
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

type TaskBucketFilter = 'new' | 'pending-lo' | 'completed';

function normalizeBucketFilter(value?: string): TaskBucketFilter | null {
  if (value === 'new' || value === 'pending-lo' || value === 'completed') {
    return value;
  }
  return null;
}

async function getTasks(role: UserRole, userId?: string, bucket?: TaskBucketFilter | null) {
  // Fetch tasks assigned to this role OR specifically to this user
  // For LOs, we want to see tasks for loans they own OR tasks assigned to them
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  
  const where: Prisma.TaskWhereInput = {
    status:
      bucket === 'completed'
        ? TaskStatus.COMPLETED
        : {
            not: TaskStatus.COMPLETED, // Default view hides completed
          },
  };

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

  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    if (bucket === 'new') {
      where.kind = TaskKind.SUBMIT_DISCLOSURES;
      where.workflowState = {
        notIn: [
          TaskWorkflowState.WAITING_ON_LO,
          TaskWorkflowState.WAITING_ON_LO_APPROVAL,
        ],
      };
    }
    if (bucket === 'pending-lo') {
      where.kind = TaskKind.SUBMIT_DISCLOSURES;
      where.workflowState = {
        in: [
          TaskWorkflowState.WAITING_ON_LO,
          TaskWorkflowState.WAITING_ON_LO_APPROVAL,
        ],
      };
    }
    if (bucket === 'completed') {
      where.kind = TaskKind.SUBMIT_DISCLOSURES;
    }
  }

  if (role === UserRole.QC) {
    if (bucket === 'new') {
      where.kind = TaskKind.SUBMIT_QC;
      where.workflowState = {
        notIn: [
          TaskWorkflowState.WAITING_ON_LO,
          TaskWorkflowState.WAITING_ON_LO_APPROVAL,
        ],
      };
    }
    if (bucket === 'pending-lo') {
      where.kind = TaskKind.SUBMIT_QC;
      where.workflowState = {
        in: [
          TaskWorkflowState.WAITING_ON_LO,
          TaskWorkflowState.WAITING_ON_LO_APPROVAL,
        ],
      };
    }
    if (bucket === 'completed') {
      where.kind = TaskKind.SUBMIT_QC;
    }
  }

  if (role === UserRole.LOAN_OFFICER) {
    if (bucket === 'pending-lo') {
      where.kind = TaskKind.LO_NEEDS_INFO;
    }
    if (bucket === 'completed') {
      where.kind = TaskKind.LO_NEEDS_INFO;
    }
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
  
  return tasks;
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
  const bucket = normalizeBucketFilter(
    typeof rawBucket === 'string' ? rawBucket : undefined
  );
  const tasks = await getTasks(sessionRole, sessionUser.id, bucket);
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
            {tasks.length} {bucket === 'completed' ? 'Completed' : 'Pending'}
          </span>
        </div>
      </div>

      <TaskList tasks={tasks} canDelete={canDelete} currentRole={sessionRole} />
    </DashboardShell>
  );
}
