import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function ResourcesPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'User',
    role: session?.user?.role || 'LOAN_OFFICER',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Resources</h1>
        <p className="app-page-subtitle">
          Shared guides, templates, and process documentation.
        </p>
      </div>
      <div className="app-surface-card">
        <p className="text-sm text-slate-600">
          This section is coming soon. You will be able to manage SOPs, training links, and team references here.
        </p>
      </div>
    </DashboardShell>
  );
}
