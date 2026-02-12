import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function ReportsPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Manager',
    role: session?.user?.role || 'MANAGER',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Reports</h1>
        <p className="app-page-subtitle">
          Review pipeline, task, and team performance trends.
        </p>
      </div>
      <div className="app-surface-card">
        <p className="text-sm text-slate-600">
          Reporting dashboards are coming soon. This page will include role-level and organization-level metrics.
        </p>
      </div>
    </DashboardShell>
  );
}
