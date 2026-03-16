'use client';

import React, { useState } from 'react';
import { requestPasswordReset } from '@/app/actions/userActions';
import { ArrowLeft, Loader2, Mail, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

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
    setStatus({
      type: 'success',
      message:
        'If an account exists for this email, we sent a secure reset link. Please check your inbox.',
    });
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
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Forgot password?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your email and we&apos;ll send you a secure password reset link.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background/50 px-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="you@federalfirstlending.com"
                  required
                />
              </div>
            </div>
            {status && (
              <p
                className={`rounded-lg border px-3 py-2 text-sm ${
                  status.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                {status.message}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Sending secure link...' : 'Send reset link'}
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
