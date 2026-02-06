import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { UserManagement } from '@/components/admin/UserManagement';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/app/actions/userActions';

export default async function UserManagementPage() {
  const session = await getServerSession(authOptions);
  const users = await getAllUsers();

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
      <UserManagement users={users} />
    </DashboardShell>
  );
}
