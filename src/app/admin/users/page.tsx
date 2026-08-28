import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { UserManagement } from '@/components/admin/UserManagement';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAllUsers,
  getPendingInvites,
  getUserManagementContext,
} from '@/app/actions/userActions';
import { listOnboardingCases } from '@/app/actions/onboardingActions';
import { UserManagementNav } from '@/components/admin/users/UserManagementNav';
import { OnboardingStatus } from '@prisma/client';

export default async function UserManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const params = await searchParams;
  const [users, invites, ctx, onboardingCases] = await Promise.all([
    getAllUsers(),
    getPendingInvites(),
    getUserManagementContext(),
    listOnboardingCases(),
  ]);

  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN_III',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">User Management</h1>
        <p className="app-page-subtitle">
          Create accounts, assign roles, and manage access.
        </p>
      </div>
      <UserManagementNav />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="app-surface-card p-5">
          <p className="text-sm text-slate-500">Active people</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{users.filter((entry) => entry.active).length}</p>
        </div>
        <div className="app-surface-card p-5">
          <p className="text-sm text-slate-500">Pending account invites</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{invites.length}</p>
        </div>
        <div className="app-surface-card p-5">
          <p className="text-sm text-slate-500">Active onboarding</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {onboardingCases.filter(
              (entry) =>
                entry.status !== OnboardingStatus.COMPLETED &&
                entry.status !== OnboardingStatus.CANCELLED,
            ).length}
          </p>
        </div>
      </div>
      <UserManagement
        users={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString(),
        }))}
        invites={invites.map((invite) => ({
          ...invite,
          createdAt: invite.createdAt.toISOString(),
          expiresAt: invite.expiresAt.toISOString(),
        }))}
        inviteEmails={invites.map((invite) => invite.email.toLowerCase())}
        currentUserId={session?.user?.id || ''}
        actorRoles={ctx.actorRoles}
        assignableRoles={ctx.assignableRoles}
        view={params.view === 'invites' ? 'invites' : 'people'}
      />
    </DashboardShell>
  );
}
