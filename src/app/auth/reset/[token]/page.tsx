'use client';

import React, { useState } from 'react';
import { resetPasswordWithToken } from '@/app/actions/userActions';
import { Loader2 } from 'lucide-react';

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    const result = await resetPasswordWithToken(params.token, password);
    if (!result.success) {
      setStatus({ type: 'error', message: result.error || 'Reset failed.' });
      setLoading(false);
      return;
    }
    setStatus({ type: 'success', message: 'Password updated. You can log in now.' });
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-slate-900">Set New Password</h1>
        <p className="text-sm text-slate-500 mt-1">Enter your new password.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
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
            className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
