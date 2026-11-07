'use client';

import { PortalLoadingState } from '@/components/layout/PortalLoadingState';

import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LoanOfficerDashboard } from '@/components/dashboard/LoanOfficerDashboard';
import { DisclosureOverview } from '@/components/dashboard/DisclosureOverview';
import { QcOverview } from '@/components/dashboard/QcOverview';
import { ProcessorPipelineOverview } from '@/components/dashboard/ProcessorPipelineOverview';
import { useImpersonation } from '@/lib/impersonation';
import { isAdmin } from '@/lib/adminTiers';
import { UserRole } from '@prisma/client';
import type { DashboardSummary, DashboardRequestPage } from '@/lib/dashboardSummary';
import { loadDashboardSnapshot } from '@/app/actions/dashboardActions';
import { usePortalRefresh } from '@/lib/usePortalRefresh';

type DashboardWrapperProps = {
  summary: DashboardSummary;
  recentRequests: DashboardRequestPage;
  loanOfficerOptions?: Array<{
    id: string;
    name: string;
  }>;
  lenderOptions?: Array<{
    id: string;
    name: string;
  }>;
  user: {
    id?: string;
    name: string;
    role: string;
    email?: string;
    loQcTwoRowPilot?: boolean;
    loDisclosureSubmissionEnabled?: boolean;
    loQcSubmissionEnabled?: boolean;
  };
};

function DashboardContent({
  summary: initialSummary,
  recentRequests: initialRecentRequests,
  user,
  loanOfficerOptions = [],
  lenderOptions = [],
}: DashboardWrapperProps) {
  const { activeRole } = useImpersonation();
  const [snapshot, setSnapshot] = React.useState({ summary: initialSummary, recentRequests: initialRecentRequests });
  React.useEffect(() => {
    setSnapshot({ summary: initialSummary, recentRequests: initialRecentRequests });
  }, [initialSummary, initialRecentRequests]);
  const { summary, recentRequests } = snapshot;
  const { error, refresh } = usePortalRefresh('overview', loadDashboardSnapshot, result => {
    if (result.userId === user.id && result.role === user.role) setSnapshot(result);
  }, activeRole === user.role && activeRole !== UserRole.PROCESSOR_SR && activeRole !== UserRole.PROCESSING_MANAGER,
  JSON.stringify([initialSummary, initialRecentRequests]));
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
      subtitle: 'Monitor both Disclosure and Jr Processing queues in one view.',
    },
    [UserRole.ADMIN_I]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and Jr Processing queues in one view.',
    },
    [UserRole.ADMIN_II]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and Jr Processing queues in one view.',
    },
    [UserRole.ADMIN_III]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and Jr Processing queues in one view.',
    },
    [UserRole.MANAGER]: {
      title: 'Desk Overview',
      subtitle: 'Monitor both Disclosure and Jr Processing queues in one view.',
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
      title: 'Retired QC Queue',
      subtitle: 'QC has been retired from active task queues.',
    },
    [UserRole.PROCESSOR_JR]: {
      title: 'Jr Processing Queue',
      subtitle: 'Review and complete processing requests.',
    },
    [UserRole.PROCESSOR_SR]: {
      title: 'Sr Processor Dashboard',
      subtitle: 'Monitor your assigned pipeline, restructures, and fundings.',
    },
    [UserRole.PROCESSING_MANAGER]: {
      title: 'Processing Management',
      subtitle: 'Oversee every Jr and Sr Processor file from submission through funding or adverse action.',
    },
  };

  const currentRoleContent = roleContent[activeRole] || {
    title: 'Overview',
    subtitle: 'Manage your assigned work and activity.',
  };
  if (activeRole !== user.role) return <PortalLoadingState label="Opening your workspace" />;
  return (
    <>
      <div className="app-page-header">
        <h1 className="app-page-title">{currentRoleContent.title}</h1>
        <p className="app-page-subtitle">{currentRoleContent.subtitle}</p>
      </div>
      {error && <p role="status" className="text-xs text-muted-foreground">{error} <button type="button" className="app-btn-secondary" onClick={refresh}>Retry</button></p>}

      {(activeRole === UserRole.LOAN_OFFICER || activeRole === UserRole.LOA) && (
        <LoanOfficerDashboard
          recentRequests={recentRequests}
          requestSummary={summary.requests}
          scopeKey={`${user.id}:${activeRole}`}
          isLoanOfficerAssistant={activeRole === UserRole.LOA}
          loanOfficerOptions={loanOfficerOptions}
          lenderOptions={lenderOptions}
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
            <DisclosureOverview summary={summary.disclosure} />
          </section>
          <section className="space-y-4">
            <div className="app-page-header">
              <h2 className="app-page-title">Jr Processing Desk</h2>
              <p className="app-page-subtitle">Live processing request workload and status mix.</p>
            </div>
            <QcOverview summary={summary.processing} />
          </section>
        </div>
      )}

      {activeRole === UserRole.PROCESSOR_JR && (
        <QcOverview summary={summary.processing} personalStarted />
      )}

      {(activeRole === UserRole.PROCESSOR_SR ||
        activeRole === UserRole.PROCESSING_MANAGER) && (
        <ProcessorPipelineOverview />
      )}

      {activeRole === UserRole.DISCLOSURE_SPECIALIST && (
        <DisclosureOverview summary={summary.disclosure} />
      )}

      {activeRole === UserRole.QC && <QcOverview summary={summary.processing} />}
    </>
  );
}

export function DashboardWrapper(props: DashboardWrapperProps) {
  return (
    <DashboardShell user={props.user}>
      <DashboardContent key={`${props.user.id}:${props.user.role}`} {...props} />
    </DashboardShell>
  );
}
