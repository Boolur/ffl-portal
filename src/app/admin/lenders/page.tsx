import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { LenderManagement } from '@/components/admin/LenderManagement';
import { listLendersForAdmin } from '@/app/actions/lenderActions';

export default async function LendersPage() {
  const session = await getServerSession(authOptions);
  const lenderResult = await listLendersForAdmin();
  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Lender Management</h1>
        <p className="app-page-subtitle">
          Manage lender profiles, logos, contact details, and portal links.
        </p>
      </div>
      {lenderResult.success ? (
        <LenderManagement lenders={lenderResult.lenders || []} />
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
