import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listLendersForDirectory } from '@/app/actions/lenderActions';
import { canAccessLendersDirectory } from '@/lib/lendersPilot';
import { LendersDirectory } from '@/components/lenders/LendersDirectory';

export default async function LendersPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Team Member',
    role: session?.user?.activeRole || session?.user?.role || 'LOAN_OFFICER',
  };

  const canAccess = canAccessLendersDirectory({
    role: user.role,
    email: session?.user?.email || '',
    name: session?.user?.name || '',
  });

  if (!canAccess) {
    return (
      <DashboardShell user={user}>
        <div className="app-page-header">
          <h1 className="app-page-title">Lenders</h1>
          <p className="app-page-subtitle">
            Lender Directory is currently enabled for pilot users.
          </p>
        </div>
        <div className="app-surface-card">
          <p className="text-sm text-slate-600">
            Your account is not in the current pilot group yet. Contact Admin if you need early access.
          </p>
        </div>
      </DashboardShell>
    );
  }

  const lenderResult = await listLendersForDirectory();

  return (
    <DashboardShell user={user}>
      {lenderResult.success ? (
        <LendersDirectory lenders={lenderResult.lenders || []} />
      ) : (
        <div className="app-surface-card">
          <p className="text-sm text-rose-700">
            {lenderResult.error || 'Could not load lender records.'}
          </p>
        </div>
      )}
    </DashboardShell>
  );
}
