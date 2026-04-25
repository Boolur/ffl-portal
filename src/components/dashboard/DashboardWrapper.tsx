'use client';

import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LoanOfficerDashboard } from '@/components/dashboard/LoanOfficerDashboard';
import { DisclosureOverview } from '@/components/dashboard/DisclosureOverview';
import { QcOverview } from '@/components/dashboard/QcOverview';
import { VaOverview } from '@/components/dashboard/VaOverview';
import type { VaRole } from '@/components/dashboard/VaOverview';
import { TaskList } from '@/components/tasks/TaskList';
import { useImpersonation } from '@/lib/impersonation';
import { isAdmin } from '@/lib/adminTiers';
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
  parentTask?: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
    title: string;
    submissionData?: Prisma.JsonValue | null;
  } | null;
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
  loanOfficerOptions?: Array<{
    id: string;
    name: string;
  }>;
  user: {
    name: string;
    role: string;
    email?: string;
    loQcTwoRowPilot?: boolean;
    loDisclosureSubmissionEnabled?: boolean;
    loQcSubmissionEnabled?: boolean;
  };
};

function DashboardContent({ loans, adminTasks, user, loanOfficerOptions = [] }: DashboardWrapperProps) {
  const { activeRole } = useImpersonation();
  const isVaTaskKind = (kind: TaskKind | null) =>
    kind === TaskKind.VA_TITLE ||
    kind === TaskKind.VA_PAYOFF ||
    kind === TaskKind.VA_APPRAISAL;
  const roleTasks = adminTasks.filter((t) => {
    if (activeRole === UserRole.VA) {
      return isVaTaskKind(t.kind);
    }
    if (activeRole === UserRole.PROCESSOR_JR) {
      return t.kind === TaskKind.VA_HOI || t.assignedRole === UserRole.PROCESSOR_JR;
    }
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
      subtitle: 'Quick snapshot of your active requests and task workload.',
    },
    [UserRole.LOA]: {
      title: 'LO Assistant Overview',
      subtitle: 'Submit requests and monitor pipeline activity across all loan officers.',
    },
    // Admins (all tiers) share the Manager overview verbatim so the Overview
    // screen is one consistent experience for every leadership role.
    [UserRole.ADMIN]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and QC queues in one view.',
    },
    [UserRole.ADMIN_I]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and QC queues in one view.',
    },
    [UserRole.ADMIN_II]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and QC queues in one view.',
    },
    [UserRole.ADMIN_III]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and QC queues in one view.',
    },
    [UserRole.MANAGER]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and QC queues in one view.',
    },
    [UserRole.DISCLOSURE_SPECIALIST]: {
      title: 'Disclosure Queue',
      subtitle: 'Focus on disclosure-related tasks and due dates.',
    },
    [UserRole.VA]: {
      title: 'VA Desk',
      subtitle: 'Work all VA queues (Title, Payoff, Appraisal) in one view.',
    },
    [UserRole.VA_TITLE]: {
      title: 'VA Queue (Title)',
      subtitle: 'Complete Title tasks and upload proof before finishing.',
    },
    [UserRole.VA_PAYOFF]: {
      title: 'VA Queue (Payoff)',
      subtitle: 'Complete Payoff tasks and upload proof before finishing.',
    },
    [UserRole.VA_APPRAISAL]: {
      title: 'Appraisal Specialist Queue',
      subtitle: 'Complete Appraisal Specialist tasks and upload proof before finishing.',
    },
    [UserRole.QC]: {
      title: 'QC Queue',
      subtitle: 'Review and complete quality control tasks.',
    },
    [UserRole.PROCESSOR_JR]: {
      title: 'JR Processor Queue',
      subtitle: 'Complete JR Processor requests and upload proof before finishing.',
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
  const isVaDeskRole =
    activeRole === UserRole.VA_TITLE ||
    activeRole === UserRole.VA_PAYOFF ||
    activeRole === UserRole.VA_APPRAISAL;
  const isProcessorTaskListRole = activeRole === UserRole.PROCESSOR_SR;

  return (
    <>
      <div className="app-page-header">
        <h1 className="app-page-title">{currentRoleContent.title}</h1>
        <p className="app-page-subtitle">{currentRoleContent.subtitle}</p>
      </div>

      {(activeRole === UserRole.LOAN_OFFICER || activeRole === UserRole.LOA) && (
        <LoanOfficerDashboard
          loans={loans}
          submissions={adminTasks}
          loanOfficerName={user.name}
          isLoanOfficerAssistant={activeRole === UserRole.LOA}
          loanOfficerOptions={loanOfficerOptions}
          disclosureEnabled={user.loDisclosureSubmissionEnabled ?? true}
          qcEnabled={user.loQcSubmissionEnabled ?? true}
        />
      )}

      {(activeRole === UserRole.MANAGER || isAdmin(activeRole)) && (
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">Disclosure Desk</h2>
              <p className="app-page-subtitle">Live disclosure request workload and status mix.</p>
            </div>
            <DisclosureOverview tasks={adminTasks} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">QC Desk</h2>
              <p className="app-page-subtitle">Live QC request workload and status mix.</p>
            </div>
            <QcOverview tasks={adminTasks} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">Appraisal Specialist Desk</h2>
              <p className="app-page-subtitle">Live Appraisal Specialist workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.VA_APPRAISAL} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">VA Desk - Payoff</h2>
              <p className="app-page-subtitle">Live VA Payoff workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.VA_PAYOFF} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">VA Desk - Title</h2>
              <p className="app-page-subtitle">Live VA Title workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.VA_TITLE} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">JR Processor Desk</h2>
              <p className="app-page-subtitle">Live JR Processor workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.PROCESSOR_JR} />
          </section>
        </div>
      )}

      {activeRole === UserRole.VA && (
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">Appraisal Specialist Desk</h2>
              <p className="app-page-subtitle">Live Appraisal Specialist workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.VA_APPRAISAL} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">VA Desk - Payoff</h2>
              <p className="app-page-subtitle">Live VA Payoff workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.VA_PAYOFF} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">VA Desk - Title</h2>
              <p className="app-page-subtitle">Live VA Title workload and status mix.</p>
            </div>
            <VaOverview tasks={adminTasks} role={UserRole.VA_TITLE} />
          </section>
        </div>
      )}

      {isVaDeskRole && (
        <VaOverview
          tasks={roleTasks}
          role={activeRole as VaRole}
        />
      )}

      {activeRole === UserRole.PROCESSOR_JR && (
        <VaOverview tasks={roleTasks} role={UserRole.PROCESSOR_JR} />
      )}

      {/* Processor SR keeps the standard task list view */}
      {isProcessorTaskListRole && (
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
