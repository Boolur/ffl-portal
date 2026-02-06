import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { UserManagement } from '@/components/admin/UserManagement';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers, getPendingInvites } from '@/app/actions/userActions';

export default async function UserManagementPage() {
  const session = await getServerSession(authOptions);
  const [users, invites] = await Promise.all([getAllUsers(), getPendingInvites()]);

  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
        <p className="text-sm text-slate-500">
          Create accounts, assign roles, and manage access.
        </p>
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
      />
    </DashboardShell>
  );
}
