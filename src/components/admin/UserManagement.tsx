'use client';

import React, { useMemo, useState } from 'react';
import { UserRole } from '@prisma/client';
import {
  createUser,
  updateUserRole,
  updateUserStatus,
  resetUserPassword,
} from '@/app/actions/userActions';
import { useRouter } from 'next/navigation';
import { PlusCircle, RefreshCw } from 'lucide-react';

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
};

type UserManagementProps = {
  users: UserRow[];
};

const roleOptions = Object.values(UserRole);

export function UserManagement({ users }: UserManagementProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    role: UserRole.LOAN_OFFICER,
    password: '',
  });

  const filteredUsers = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return users;
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term)
    );
  }, [search, users]);

  const handleCreate = async () => {
    setStatus(null);
    const result = await createUser(formState);
    if (!result.success) {
      setStatus({ type: 'error', message: result.error || 'Failed to create user.' });
      return;
    }
    setFormState({
      name: '',
      email: '',
      role: UserRole.LOAN_OFFICER,
      password: '',
    });
    setStatus({ type: 'success', message: 'User created.' });
    router.refresh();
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    await updateUserRole(userId, role);
    router.refresh();
  };

  const handleStatusChange = async (userId: string, active: boolean) => {
    await updateUserStatus(userId, active);
    router.refresh();
  };

  const handleResetPassword = async (userId: string) => {
    const nextPassword = window.prompt('Enter a new password for this user:');
    if (!nextPassword) return;
    const result = await resetUserPassword(userId, nextPassword);
    if (!result.success) {
      setStatus({ type: 'error', message: result.error || 'Failed to reset password.' });
      return;
    }
    setStatus({ type: 'success', message: 'Password updated.' });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Create User</h2>
            <p className="text-sm text-slate-500 mt-1">
              Add a new account and assign role-based access.
            </p>
          </div>
          <button
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3">
          <input
            value={formState.name}
            onChange={(event) => setFormState({ ...formState, name: event.target.value })}
            placeholder="Full name"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <input
            value={formState.email}
            onChange={(event) => setFormState({ ...formState, email: event.target.value })}
            placeholder="Email"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <select
            value={formState.role}
            onChange={(event) =>
              setFormState({ ...formState, role: event.target.value as UserRole })
            }
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            type="password"
            value={formState.password}
            onChange={(event) => setFormState({ ...formState, password: event.target.value })}
            placeholder="Temporary password"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <PlusCircle className="w-4 h-4" />
            Create
          </button>
        </div>

        {status && (
          <p
            className={`mt-3 text-sm ${
              status.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {status.message}
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">User Directory</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage roles, access, and passwords.
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
        </div>

        <div className="mt-4 space-y-3">
          {filteredUsers.length === 0 && (
            <p className="text-sm text-slate-500">No users found.</p>
          )}
          {filteredUsers.map((user) => (
            <div
              key={user.id}
              className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Created {new Date(user.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={user.role}
                  onChange={(event) => handleRoleChange(user.id, event.target.value as UserRole)}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={user.active}
                    onChange={(event) => handleStatusChange(user.id, event.target.checked)}
                  />
                  Active
                </label>

                <button
                  onClick={() => handleResetPassword(user.id)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Reset Password
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
