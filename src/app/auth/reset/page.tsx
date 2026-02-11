'use client';

import React, { useState } from 'react';
import { requestPasswordReset } from '@/app/actions/userActions';
import { Loader2 } from 'lucide-react';

export default function ResetRequestPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    const result = await requestPasswordReset(email);
    if (!result.success) {
      setStatus({ type: 'error', message: result.error || 'Reset failed.' });
      setLoading(false);
      return;
    }
    setStatus({ type: 'success', message: 'Check your email for reset instructions.' });
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h1 className="text-2xl font-bold text-slate-900">Reset Password</h1>
        <p className="text-sm text-slate-500 mt-1">We’ll email you a reset link.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  );
}
