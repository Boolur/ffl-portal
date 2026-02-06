'use client';

import React, { useMemo, useState } from 'react';
import { UserRole } from '@prisma/client';
import {
  createUser,
  inviteUser,
  updateUserRole,
  updateUserStatus,
  resetUserPassword,
  requestPasswordReset,
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
  invites: Array<{
    id: string;
    email: string;
    role: UserRole;
    createdAt: string;
    expiresAt: string;
  }>;
  inviteEmails: string[];
  currentUserId: string;
};

const roleOptions = Object.values(UserRole);

export function UserManagement({ users, invites, inviteEmails, currentUserId }: UserManagementProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [formState, setFormState] = useState<{
    name: string;
    email: string;
    role: UserRole;
    password: string;
  }>({
    name: '',
    email: '',
    role: UserRole.LOAN_OFFICER,
    password: '',
  });
  const [inviteState, setInviteState] = useState<{
    name: string;
    email: string;
    role: UserRole;
  }>({
    name: '',
    email: '',
    role: UserRole.LOAN_OFFICER,
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

  const handleInvite = async () => {
    setStatus(null);
    if (!currentUserId) {
      setStatus({ type: 'error', message: 'Missing inviter identity.' });
      return;
    }
    try {
      const result = await inviteUser({
        name: inviteState.name,
        email: inviteState.email,
        role: inviteState.role,
        createdById: currentUserId,
      });
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to send invite.' });
        return;
      }
      setInviteState({ name: '', email: '', role: UserRole.LOAN_OFFICER });
      setStatus({ type: 'success', message: 'Invite sent.' });
      router.refresh();
    } catch (error) {
      console.error('Invite failed', error);
      setStatus({ type: 'error', message: 'Failed to send invite.' });
    }
  };

  const handleSendResetEmail = async (email: string) => {
    const confirmed = window.confirm(`Send reset link to ${email}?`);
    if (!confirmed) return;
    const result = await requestPasswordReset(email);
    if (!result.success) {
      setStatus({ type: 'error', message: result.error || 'Failed to send reset link.' });
      return;
    }
    setStatus({ type: 'success', message: 'Password reset email sent.' });
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
            <h2 className="text-lg font-semibold text-slate-900">Invite User</h2>
            <p className="text-sm text-slate-500 mt-1">
              Send an email invite to set a password.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_auto] gap-3">
          <input
            value={inviteState.name}
            onChange={(event) => setInviteState({ ...inviteState, name: event.target.value })}
            placeholder="Full name"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <input
            value={inviteState.email}
            onChange={(event) => setInviteState({ ...inviteState, email: event.target.value })}
            placeholder="Email"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <select
            value={inviteState.role}
            onChange={(event) =>
              setInviteState({ ...inviteState, role: event.target.value as UserRole })
            }
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button
            onClick={handleInvite}
            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <PlusCircle className="w-4 h-4" />
            Send Invite
          </button>
        </div>
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
                {inviteEmails.includes(user.email.toLowerCase()) && (
                  <p className="text-[11px] text-amber-600 mt-1">Invite pending</p>
                )}
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
                <button
                  onClick={() => handleSendResetEmail(user.email)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-700"
                >
                  Send Reset Link
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Pending Invites</h2>
        <p className="text-sm text-slate-500 mt-1">Invitations waiting to be accepted.</p>
        <div className="mt-4 space-y-2">
          {invites.length === 0 && (
            <p className="text-sm text-slate-500">No pending invites.</p>
          )}
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-2"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{invite.email}</p>
                <p className="text-xs text-slate-500">
                  {invite.role.replace(/_/g, ' ')} • Expires{' '}
                  {new Date(invite.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <span className="text-xs text-slate-400">
                Sent {new Date(invite.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
