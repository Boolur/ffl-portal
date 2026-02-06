import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function TeamPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Manager',
    role: session?.user?.role || 'MANAGER',
  };

  return (
    <DashboardShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Team</h1>
        <p className="text-sm text-slate-500">
          Team management tools are coming soon.
        </p>
      </div>
    </DashboardShell>
  );
}
