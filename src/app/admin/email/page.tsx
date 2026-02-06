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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Email Settings</h1>
        <p className="text-sm text-slate-500">
          SMTP configuration and templates will live here.
        </p>
      </div>
    </DashboardShell>
  );
}
