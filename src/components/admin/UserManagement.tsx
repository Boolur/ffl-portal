'use client';

import React, { useMemo, useState } from 'react';
import { UserRole } from '@prisma/client';
import {
  createUser,
  inviteUser,
  updateUserRoles,
  updateUserStatus,
  updateUserDeskPermissions,
  updateUserName,
  resetUserPassword,
  requestPasswordReset,
  deleteInvite,
  resendInvite,
  deleteUser,
} from '@/app/actions/userActions';
import { useRouter } from 'next/navigation';
import { PlusCircle, RefreshCw, Loader2, UserPlus, Send, Mail } from 'lucide-react';

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
  loDisclosureSubmissionEnabled: boolean;
  loQcSubmissionEnabled: boolean;
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
  const [createStatus, setCreateStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [inviteStatus, setInviteStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [directoryStatus, setDirectoryStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [formState, setFormState] = useState<{
    name: string;
    email: string;
    roles: UserRole[];
    password: string;
  }>({
    name: '',
    email: '',
    roles: [UserRole.LOAN_OFFICER],
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
    const matchingUsers = !term
      ? users
      : users.filter(
          (user) =>
            user.name.toLowerCase().includes(term) ||
            user.email.toLowerCase().includes(term)
        );

    return [...matchingUsers].sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return a.email.localeCompare(b.email, undefined, { sensitivity: 'base' });
    });
  }, [search, users]);

  const handleCreate = async () => {
    if (isCreating) return;
    setCreateStatus(null);
    setIsCreating(true);
    try {
      const result = await createUser(formState);
      if (!result.success) {
        setCreateStatus({ type: 'error', message: result.error || 'Failed to create user.' });
        return;
      }
      setFormState({
        name: '',
        email: '',
        roles: [UserRole.LOAN_OFFICER],
        password: '',
      });
      setCreateStatus({ type: 'success', message: 'User created successfully.' });
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  };

  const handleInvite = async () => {
    if (isInviting) return;
    setInviteStatus(null);
    if (!currentUserId) {
      setInviteStatus({ type: 'error', message: 'Missing inviter identity.' });
      return;
    }
    setIsInviting(true);
    try {
      const result = await inviteUser({
        name: inviteState.name,
        email: inviteState.email,
        role: inviteState.role,
        createdById: currentUserId,
      });
      if (!result.success) {
        setInviteStatus({ type: 'error', message: result.error || 'Failed to send invite.' });
        return;
      }
      setInviteState({ name: '', email: '', role: UserRole.LOAN_OFFICER });
      setInviteStatus({ type: 'success', message: 'Invite sent successfully.' });
      router.refresh();
    } catch (error) {
      console.error('Invite failed', error);
      setInviteStatus({ type: 'error', message: 'Failed to send invite.' });
    } finally {
      setIsInviting(false);
    }
  };

  const handleSendResetEmail = async (email: string) => {
    const confirmed = window.confirm(`Send reset link to ${email}?`);
    if (!confirmed) return;
    const result = await requestPasswordReset(email);
    if (!result.success) {
      setDirectoryStatus({ type: 'error', message: result.error || 'Failed to send reset link.' });
      return;
    }
    setDirectoryStatus({ type: 'success', message: 'Password reset email sent.' });
  };

  const handleResendInvite = async (inviteId: string) => {
    setPendingStatus(null);
    const result = await resendInvite(inviteId);
    if (!result.success) {
      setPendingStatus({ type: 'error', message: result.error || 'Failed to resend invite.' });
      return;
    }
    setPendingStatus({ type: 'success', message: 'Invite resent successfully.' });
    router.refresh();
  };

  const handleDeleteInvite = async (inviteId: string) => {
    const confirmed = window.confirm('Delete this invite?');
    if (!confirmed) return;
    setPendingStatus(null);
    const result = await deleteInvite(inviteId);
    if (!result.success) {
      setPendingStatus({ type: 'error', message: result.error || 'Failed to delete invite.' });
      return;
    }
    setPendingStatus({ type: 'success', message: 'Invite deleted.' });
    router.refresh();
  };

  const handleRoleChange = async (userId: string, roles: UserRole[]) => {
    const nextRoles = Array.from(new Set(roles));
    if (nextRoles.length === 0) {
      setDirectoryStatus({ type: 'error', message: 'Each user must have at least one role.' });
      return;
    }
    await updateUserRoles(userId, nextRoles);
    router.refresh();
  };

  const toggleRoleInList = (roles: UserRole[], role: UserRole) => {
    if (roles.includes(role)) return roles.filter((r) => r !== role);
    return [...roles, role];
  };

  const handleStatusChange = async (userId: string, active: boolean) => {
    await updateUserStatus(userId, active);
    router.refresh();
  };

  const handleDeskPermissionsChange = async (
    userId: string,
    nextPermissions: { loDisclosureSubmissionEnabled: boolean; loQcSubmissionEnabled: boolean }
  ) => {
    const result = await updateUserDeskPermissions({
      userId,
      loDisclosureSubmissionEnabled: nextPermissions.loDisclosureSubmissionEnabled,
      loQcSubmissionEnabled: nextPermissions.loQcSubmissionEnabled,
    });
    if (!result.success) {
      setDirectoryStatus({
        type: 'error',
        message: result.error || 'Failed to update LO desk permissions.',
      });
      return;
    }
    setDirectoryStatus({ type: 'success', message: 'LO desk permissions updated.' });
    router.refresh();
  };

  const handleResetPassword = async (userId: string) => {
    const nextPassword = window.prompt('Enter a new password for this user:');
    if (!nextPassword) return;
    const result = await resetUserPassword(userId, nextPassword);
    if (!result.success) {
      setDirectoryStatus({ type: 'error', message: result.error || 'Failed to reset password.' });
      return;
    }
    setDirectoryStatus({ type: 'success', message: 'Password updated.' });
  };

  const handleDeleteUser = async (userId: string) => {
    const confirmed = window.confirm(
      'Delete this account permanently? This cannot be undone.'
    );
    if (!confirmed) return;
    setDirectoryStatus(null);
    try {
      const result = await deleteUser(userId, currentUserId);
      if (!result.success) {
        const message = result.error || 'Failed to delete user.';
        setDirectoryStatus({ type: 'error', message });
        window.alert(message);
        return;
      }
      setDirectoryStatus({ type: 'success', message: 'User deleted.' });
      window.alert('User deleted.');
      router.refresh();
    } catch (error) {
      console.error('Delete user failed unexpectedly', error);
      setDirectoryStatus({
        type: 'error',
        message: 'Delete failed unexpectedly. Please try again.',
      });
    }
  };

  const handleEditUserName = async (userId: string, currentName: string) => {
    const nextName = window.prompt('Enter updated display name:', currentName);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === currentName.trim()) return;

    const result = await updateUserName(userId, trimmed);
    if (!result.success) {
      const message = result.error || 'Failed to update name.';
      setDirectoryStatus({ type: 'error', message });
      window.alert(message);
      return;
    }
    setDirectoryStatus({ type: 'success', message: 'User name updated.' });
    router.refresh();
  };

  const renderStatus = (
    sectionStatus: { type: 'success' | 'error'; message: string } | null
  ) =>
    sectionStatus ? (
      <p
        className={`mt-3 text-sm rounded-lg border px-3 py-2 ${
          sectionStatus.type === 'success'
            ? 'text-green-700 bg-green-50 border-green-200'
            : 'text-red-700 bg-red-50 border-red-200'
        }`}
      >
        {sectionStatus.message}
      </p>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Account Provisioning</h2>
            <p className="text-sm text-slate-500 mt-1">
              Create users directly or send secure invites with role-based access.
            </p>
          </div>
          <button
            onClick={() => router.refresh()}
            className="app-btn-secondary"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">Create User</h3>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <input
                name="create_name"
                autoComplete="off"
                value={formState.name}
                onChange={(event) => setFormState({ ...formState, name: event.target.value })}
                placeholder="Full name"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              />
              <input
                name="create_email"
                autoComplete="off"
                value={formState.email}
                onChange={(event) => setFormState({ ...formState, email: event.target.value })}
                placeholder="Email"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Roles
                  </p>
                  <div className="max-h-36 overflow-y-auto space-y-1.5">
                    {roleOptions.map((role) => (
                      <label key={role} className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={formState.roles.includes(role)}
                          onChange={() =>
                            setFormState((prev) => ({
                              ...prev,
                              roles: toggleRoleInList(prev.roles, role),
                            }))
                          }
                        />
                        {role.replace(/_/g, ' ')}
                      </label>
                    ))}
                  </div>
                </div>
                <input
                  type="password"
                  name="create_temp_password"
                  autoComplete="new-password"
                  value={formState.password}
                  onChange={(event) => setFormState({ ...formState, password: event.target.value })}
                  placeholder="Temporary password"
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
                {isCreating ? 'Creating...' : 'Create User'}
              </button>
            </div>
            {renderStatus(createStatus)}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-900">Invite User</h3>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <input
                name="invite_name"
                autoComplete="off"
                value={inviteState.name}
                onChange={(event) => setInviteState({ ...inviteState, name: event.target.value })}
                placeholder="Full name"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              />
              <input
                name="invite_email"
                autoComplete="off"
                value={inviteState.email}
                onChange={(event) => setInviteState({ ...inviteState, email: event.target.value })}
                placeholder="Email"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={inviteState.role}
                  onChange={(event) =>
                    setInviteState({ ...inviteState, role: event.target.value as UserRole })
                  }
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleInvite}
                  disabled={isInviting}
                  className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isInviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {isInviting ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </div>
            {renderStatus(inviteStatus)}
          </div>
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
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {filteredUsers.length} Users
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users"
              className="w-[220px] max-w-[52vw] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mt-4">
          {renderStatus(directoryStatus)}

          {filteredUsers.length === 0 && (
            <p className="text-sm text-slate-500 mt-3">No users found.</p>
          )}
          {filteredUsers.length > 0 && (
            <>
              <div className="hidden lg:block mt-3 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full table-fixed">
                  <thead className="sticky top-0 z-[1] bg-slate-50">
                    <tr className="border-b border-slate-200 text-left">
                      <th className="w-[22%] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        User
                      </th>
                      <th className="w-[32%] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Roles
                      </th>
                      <th className="w-[22%] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        LO Desk Submit Access
                      </th>
                      <th className="w-[8%] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Access
                      </th>
                      <th className="w-[16%] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredUsers.map((user) => {
                      const roleList = user.roles?.length ? user.roles : [user.role];
                      return (
                        <tr key={user.id} className="align-top hover:bg-slate-50/70">
                          <td className="px-4 py-3.5">
                            <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {inviteEmails.includes(user.email.toLowerCase()) && (
                                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  Invite Pending
                                </span>
                              )}
                              <span className="text-[11px] text-slate-400">
                                Created {new Date(user.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="grid grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-1.5">
                              {roleOptions.map((role) => {
                                const checked = roleList.includes(role);
                                return (
                                  <label
                                    key={`${user.id}-${role}`}
                                    className="inline-flex items-center gap-1.5 text-[11px] text-slate-700"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        handleRoleChange(user.id, toggleRoleInList(roleList, role))
                                      }
                                    />
                                    <span className="truncate">{role.replace(/_/g, ' ')}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                              <label className="inline-flex items-center gap-2 text-[11px] text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={user.loDisclosureSubmissionEnabled}
                                  onChange={(event) =>
                                    handleDeskPermissionsChange(user.id, {
                                      loDisclosureSubmissionEnabled: event.target.checked,
                                      loQcSubmissionEnabled: user.loQcSubmissionEnabled,
                                    })
                                  }
                                />
                                Disclosure Submit
                              </label>
                              <label className="inline-flex items-center gap-2 text-[11px] text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={user.loQcSubmissionEnabled}
                                  onChange={(event) =>
                                    handleDeskPermissionsChange(user.id, {
                                      loDisclosureSubmissionEnabled:
                                        user.loDisclosureSubmissionEnabled,
                                      loQcSubmissionEnabled: event.target.checked,
                                    })
                                  }
                                />
                                QC Submit
                              </label>
                              <p className="text-[10px] text-slate-500">
                                Applies to LO submission access.
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={user.active}
                                onChange={(event) => handleStatusChange(user.id, event.target.checked)}
                              />
                              Active
                            </label>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                onClick={() => handleEditUserName(user.id, user.name)}
                                className="app-btn-secondary h-8 px-2.5 text-xs"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleResetPassword(user.id)}
                                className="app-btn-secondary h-8 px-2.5 text-xs"
                              >
                                Reset Password
                              </button>
                              <button
                                onClick={() => handleSendResetEmail(user.email)}
                                className="app-btn-secondary h-8 px-2.5 text-xs"
                              >
                                Send Reset Link
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="app-btn-danger h-8 px-2.5 text-xs"
                              >
                                Delete Account
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden mt-3 space-y-2.5">
                {filteredUsers.map((user) => {
                  const roleList = user.roles?.length ? user.roles : [user.role];
                  return (
                    <div key={user.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
                          <p className="text-xs text-slate-500 truncate">{user.email}</p>
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 shrink-0">
                          <input
                            type="checkbox"
                            checked={user.active}
                            onChange={(event) => handleStatusChange(user.id, event.target.checked)}
                          />
                          Active
                        </label>
                      </div>

                      <div className="mt-2.5 grid grid-cols-2 gap-x-2.5 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        {roleOptions.map((role) => {
                          const checked = roleList.includes(role);
                          return (
                            <label
                              key={`${user.id}-mobile-${role}`}
                              className="inline-flex items-center gap-1.5 text-[11px] text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  handleRoleChange(user.id, toggleRoleInList(roleList, role))
                                }
                              />
                              <span className="truncate">{role.replace(/_/g, ' ')}</span>
                            </label>
                          );
                        })}
                      </div>

                      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          LO Desk Submit Access
                        </p>
                        <div className="grid grid-cols-1 gap-1.5">
                          <label className="inline-flex items-center gap-2 text-[11px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={user.loDisclosureSubmissionEnabled}
                              onChange={(event) =>
                                handleDeskPermissionsChange(user.id, {
                                  loDisclosureSubmissionEnabled: event.target.checked,
                                  loQcSubmissionEnabled: user.loQcSubmissionEnabled,
                                })
                              }
                            />
                            Disclosure Submit
                          </label>
                          <label className="inline-flex items-center gap-2 text-[11px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={user.loQcSubmissionEnabled}
                              onChange={(event) =>
                                handleDeskPermissionsChange(user.id, {
                                  loDisclosureSubmissionEnabled:
                                    user.loDisclosureSubmissionEnabled,
                                  loQcSubmissionEnabled: event.target.checked,
                                })
                              }
                            />
                            QC Submit
                          </label>
                        </div>
                        <p className="mt-1.5 text-[10px] text-slate-500">
                          Applies to LO submission access.
                        </p>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {inviteEmails.includes(user.email.toLowerCase()) && (
                          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            Invite Pending
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          Created {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => handleEditUserName(user.id, user.name)}
                          className="app-btn-secondary h-8 px-2.5 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleResetPassword(user.id)}
                          className="app-btn-secondary h-8 px-2.5 text-xs"
                        >
                          Reset Password
                        </button>
                        <button
                          onClick={() => handleSendResetEmail(user.email)}
                          className="app-btn-secondary h-8 px-2.5 text-xs"
                        >
                          Send Reset Link
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="app-btn-danger h-8 px-2.5 text-xs"
                        >
                          Delete Account
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Pending Invites</h2>
        <p className="text-sm text-slate-500 mt-1">Invitations waiting to be accepted.</p>
        <div className="mt-4 space-y-2">
          {renderStatus(pendingStatus)}
          {invites.length === 0 && (
            <p className="text-sm text-slate-500">No pending invites.</p>
          )}
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border border-slate-200 rounded-lg px-4 py-2"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{invite.email}</p>
                <p className="text-xs text-slate-500">
                  {invite.role.replace(/_/g, ' ')} • Expires{' '}
                  {new Date(invite.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-400">
                  Sent {new Date(invite.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleResendInvite(invite.id)}
                  className="app-btn-secondary h-8 px-2.5 text-xs"
                >
                  Resend
                </button>
                <button
                  onClick={() => handleDeleteInvite(invite.id)}
                  className="app-btn-danger h-8 px-2.5 text-xs"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
