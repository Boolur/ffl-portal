import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function EmailSettingsPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Email Settings</h1>
        <p className="app-page-subtitle">
          Configure sender identity and invitation/reset delivery settings.
        </p>
      </div>
      <div className="app-surface-card">
        <p className="text-sm text-slate-600">
          Email configuration controls are coming soon. This area will hold templates, sender settings, and delivery diagnostics.
        </p>
      </div>
    </DashboardShell>
  );
}
