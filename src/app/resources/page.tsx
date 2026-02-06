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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Resources</h1>
        <p className="text-sm text-slate-500">
          This section is coming soon.
        </p>
      </div>
    </DashboardShell>
  );
}
