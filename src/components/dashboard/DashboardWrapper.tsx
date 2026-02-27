'use client';

import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LoanOfficerDashboard } from '@/components/dashboard/LoanOfficerDashboard';
import { DisclosureOverview } from '@/components/dashboard/DisclosureOverview';
import { QcOverview } from '@/components/dashboard/QcOverview';
import { DepartmentBoard } from '@/components/admin/DepartmentBoard';
import { TaskList } from '@/components/tasks/TaskList';
import { useImpersonation } from '@/lib/impersonation';
import {
  DisclosureDecisionReason,
  Prisma,
  TaskAttachmentPurpose,
  TaskKind,
  TaskPriority,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';

type DashboardLoan = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  amount: number;
  stage: string;
  updatedAt: Date;
};

type DashboardTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  loanOfficerApprovedAt: Date | null;
  submissionData?: Prisma.JsonValue | null;
  assignedRole: string | null;
  assignedUser: { name: string } | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage?: string;
    loanOfficer: { name: string };
  };
  attachments?: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
  }[];
};

type DashboardWrapperProps = {
  loans: DashboardLoan[];
  adminTasks: DashboardTask[];
  user: { name: string; role: string };
};

function DashboardContent({ loans, adminTasks, user }: DashboardWrapperProps) {
  const { activeRole } = useImpersonation();
  const roleTasks = adminTasks.filter((t) => {
    if (t.assignedRole === activeRole) return true;
    if (activeRole === UserRole.DISCLOSURE_SPECIALIST) {
      return t.kind === TaskKind.SUBMIT_DISCLOSURES;
    }
    if (activeRole === UserRole.QC) {
      return t.kind === TaskKind.SUBMIT_QC;
    }
    return false;
  });

  const roleContent: Record<string, { title: string; subtitle: string }> = {
    [UserRole.LOAN_OFFICER]: {
      title: 'Overview',
      subtitle: 'Quick snapshot of your pipeline and active tasks.',
    },
    [UserRole.ADMIN]: {
      title: 'Operations Overview',
      subtitle: 'Monitor teams, queues, and bottlenecks across the organization.',
    },
    [UserRole.MANAGER]: {
      title: 'Team Overview',
      subtitle: 'Track workload health and keep departments moving.',
    },
    [UserRole.DISCLOSURE_SPECIALIST]: {
      title: 'Disclosure Queue',
      subtitle: 'Focus on disclosure-related tasks and due dates.',
    },
    [UserRole.VA]: {
      title: 'VA Queue',
      subtitle: 'Work assigned support tasks with clear priority.',
    },
    [UserRole.VA_TITLE]: {
      title: 'VA Queue (Title)',
      subtitle: 'Complete Title tasks and upload proof before finishing.',
    },
    [UserRole.VA_HOI]: {
      title: 'VA Queue (HOI)',
      subtitle: 'Complete HOI tasks and upload proof before finishing.',
    },
    [UserRole.VA_PAYOFF]: {
      title: 'VA Queue (Payoff)',
      subtitle: 'Complete Payoff tasks and upload proof before finishing.',
    },
    [UserRole.VA_APPRAISAL]: {
      title: 'VA Queue (Appraisal)',
      subtitle: 'Complete Appraisal tasks and upload proof before finishing.',
    },
    [UserRole.QC]: {
      title: 'QC Queue',
      subtitle: 'Review and complete quality control tasks.',
    },
    [UserRole.PROCESSOR_JR]: {
      title: 'Processor Queue',
      subtitle: 'Manage active processing tasks and handoffs.',
    },
    [UserRole.PROCESSOR_SR]: {
      title: 'Processor Queue',
      subtitle: 'Manage active processing tasks and escalations.',
    },
  };

  const currentRoleContent = roleContent[activeRole] || {
    title: 'Overview',
    subtitle: 'Manage your assigned work and activity.',
  };

  return (
    <>
      <div className="app-page-header">
        <h1 className="app-page-title">{currentRoleContent.title}</h1>
        <p className="app-page-subtitle">{currentRoleContent.subtitle}</p>
      </div>

      {activeRole === 'LOAN_OFFICER' && (
        <LoanOfficerDashboard
          loans={loans}
          submissions={adminTasks}
          loanOfficerName={user.name}
        />
      )}
      
      {(activeRole === 'ADMIN' || activeRole === 'MANAGER') && (
        <DepartmentBoard tasks={adminTasks} />
      )}

      {/* For other roles, we show their specific queue */}
      {[
        'VA',
        'VA_TITLE',
        'VA_HOI',
        'VA_PAYOFF',
        'VA_APPRAISAL',
        'PROCESSOR_JR',
        'PROCESSOR_SR',
      ].includes(activeRole) && (
        <div className="bg-card rounded-xl border border-border shadow-sm">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Active Tasks</h2>
            <span className="app-count-badge">
              {roleTasks.length} Pending
            </span>
          </div>
          <div className="p-6">
            <TaskList tasks={roleTasks} currentRole={activeRole} />
          </div>
        </div>
      )}

      {activeRole === UserRole.DISCLOSURE_SPECIALIST && (
        <DisclosureOverview tasks={roleTasks} />
      )}

      {activeRole === UserRole.QC && <QcOverview tasks={roleTasks} />}
    </>
  );
}

export function DashboardWrapper(props: DashboardWrapperProps) {
  return (
    <DashboardShell user={props.user}>
      <DashboardContent {...props} />
    </DashboardShell>
  );
}
