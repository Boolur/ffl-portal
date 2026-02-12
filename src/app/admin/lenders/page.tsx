import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function LendersPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Lender Management</h1>
        <p className="app-page-subtitle">
          Manage lender profiles, overlays, and product configuration.
        </p>
      </div>
      <div className="app-surface-card">
        <p className="text-sm text-slate-600">
          Lender management is coming soon. This page will centralize lender relationships and setup details.
        </p>
      </div>
    </DashboardShell>
  );
}
