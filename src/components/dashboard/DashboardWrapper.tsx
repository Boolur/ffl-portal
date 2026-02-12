'use client';

import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LoanOfficerDashboard } from '@/components/dashboard/LoanOfficerDashboard';
import { DepartmentBoard } from '@/components/admin/DepartmentBoard';
import { TaskList } from '@/components/tasks/TaskList';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';

type DashboardWrapperProps = {
  loans: any[];
  adminTasks: any[];
  user: { name: string; role: string };
};

function DashboardContent({ loans, adminTasks, user }: DashboardWrapperProps) {
  const { activeRole } = useImpersonation();
  const roleTasks = adminTasks.filter((t) => t.assignedRole === activeRole);

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
      {['DISCLOSURE_SPECIALIST', 'VA', 'QC', 'PROCESSOR_JR', 'PROCESSOR_SR'].includes(activeRole) && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Active Tasks</h2>
            <span className="app-count-badge">
              {roleTasks.length} Pending
            </span>
          </div>
          <div className="p-6">
            <TaskList tasks={roleTasks} />
          </div>
        </div>
      )}
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
