import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTeamMembers } from '@/app/actions/teamActions';
import { TeamManagement } from '@/components/admin/TeamManagement';

export default async function TeamPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Manager',
    role: session?.user?.role || 'MANAGER',
    id: session?.user?.id || '',
  };

  const members = await getTeamMembers();

  return (
    <DashboardShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Team Management</h1>
        <p className="text-sm text-slate-500">
          Oversee team performance, manage workloads, and reassign pipelines.
        </p>
      </div>
      <TeamManagement members={members} currentUserId={user.id} />
    </DashboardShell>
  );
}
