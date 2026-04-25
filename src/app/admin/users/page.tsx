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

export default async function UserManagementPage() {
  const session = await getServerSession(authOptions);
  const [users, invites, ctx] = await Promise.all([
    getAllUsers(),
    getPendingInvites(),
    getUserManagementContext(),
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
      />
    </DashboardShell>
  );
}
