'use client';

import React, { useMemo, useState } from 'react';
import { resetPasswordWithToken } from '@/app/actions/userActions';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const params = useParams();
  const router = useRouter();
  const token = useMemo(() => {
    const raw = params?.token;
    if (Array.isArray(raw)) return raw[0] || '';
    return raw || '';
  }, [params]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    if (!token) {
      setStatus({ type: 'error', message: 'Reset link is missing a token.' });
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setStatus({ type: 'error', message: 'Password must be at least 8 characters.' });
      setLoading(false);
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      setLoading(false);
      return;
    }
    const result = await resetPasswordWithToken(token, password);
    if (!result.success) {
      setStatus({ type: 'error', message: result.error || 'Reset failed.' });
      setLoading(false);
      return;
    }
    setStatus({ type: 'success', message: 'Password updated. Redirecting to sign in...' });
    setTimeout(() => router.push('/login'), 1200);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center app-shell-bg px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.1),transparent_50%)]" />
      <div className="w-full max-w-[460px] relative z-10">
        <div className="flex justify-center mb-8">
          <div className="relative h-20 w-72">
            <Image
              src="/assets/Federal-First-Lending-text.png"
              alt="Federal First Lending"
              fill
              className="object-contain drop-shadow-sm"
              priority
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/95 backdrop-blur-xl p-8 shadow-2xl shadow-slate-950/10">
          <div className="text-center mb-8">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <KeyRound className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Set a new password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter and confirm your new password to finish resetting your account.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                New password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background/50 px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="At least 8 characters"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Confirm new password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background/50 px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="Re-enter password"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {status && (
              <p
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  status.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                {status.type === 'success' && <CheckCircle2 className="h-4 w-4" />}
                <span>{status.message}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Updating password...' : 'Update password'}
            </button>
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
