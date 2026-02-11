'use client';

import React, { useState } from 'react';
import { acceptInvite } from '@/app/actions/userActions';

export default function InviteAcceptPage({ params }: { params: { token: string } }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);
    if (!name.trim()) {
      setStatus({ type: 'error', message: 'Full name is required.' });
      return;
    }
    if (!password) {
      setStatus({ type: 'error', message: 'Password is required.' });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }
    setLoading(true);
    try {
      const result = await acceptInvite({ token: params.token, name, password });
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Invite failed.' });
        return;
      }
      setStatus({ type: 'success', message: 'Account created. You can log in now.' });
    } catch (error) {
      console.error('Invite acceptance failed', error);
      setStatus({ type: 'error', message: 'Invite failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-slate-900">Accept Invite</h1>
        <p className="text-sm text-slate-500 mt-1">Set your password to access the portal.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Full Name
            </label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              required
            />
          </div>
          {status && (
            <p
              className={`text-sm ${
                status.type === 'success' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {status.message}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-70"
          >
            {loading ? 'Saving...' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
