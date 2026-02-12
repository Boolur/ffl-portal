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
      <div className="app-page-header">
        <h1 className="app-page-title">Team Management</h1>
        <p className="app-page-subtitle">
          Oversee team performance, manage workloads, and reassign pipelines.
        </p>
      </div>
      <TeamManagement members={members} currentUserId={user.id} />
    </DashboardShell>
  );
}
