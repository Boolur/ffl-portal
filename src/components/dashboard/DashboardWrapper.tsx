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

function DashboardContent({ loans, adminTasks }: DashboardWrapperProps) {
  const { activeRole } = useImpersonation();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {activeRole === 'LOAN_OFFICER' ? 'My Pipeline' : 
           activeRole === 'ADMIN' || activeRole === 'MANAGER' ? 'Operations Overview' : 
           'Task Queue'}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          {activeRole === 'LOAN_OFFICER' 
            ? 'Track your active loans and upcoming tasks.' 
            : activeRole === 'ADMIN' || activeRole === 'MANAGER'
            ? 'Monitor department workloads and bottlenecks.'
            : 'Manage your assigned tasks and workflow steps.'}
        </p>
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
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
           <TaskList tasks={adminTasks.filter(t => t.assignedRole === activeRole)} />
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
