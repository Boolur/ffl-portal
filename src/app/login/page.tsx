'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl: '/',
    });

    if (result?.error) {
      setError('Invalid email or password.');
      setLoading(false);
      return;
    }

    if (result?.ok) {
      router.replace(result.url || '/');
      return;
    }

    setError('Sign in failed. Please try again.');
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 app-shell-bg">
      <section className="hidden lg:flex relative overflow-hidden border-r border-border">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.22),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(99,102,241,0.2),transparent_35%),radial-gradient(circle_at_50%_80%,rgba(14,165,233,0.18),transparent_45%)]" />
        <div className="relative z-10 flex h-full w-full flex-col justify-between p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Federal First Lending Portal
          </div>
          <div className="space-y-6">
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground">
              Modern lending operations, built for high-performance teams.
            </h1>
            <p className="max-w-lg text-sm text-muted-foreground">
              Manage pipelines, disclosures, QC, and team workflows in one secure workspace.
            </p>
            <div className="grid gap-3">
              <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm text-card-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Real-time role-based workflow visibility
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm text-card-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Secure document and task lifecycle tracking
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Designed for Loan Officers, Disclosure, QC, VAs, Managers, and Admins.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl shadow-slate-950/5">
          <h2 className="text-2xl font-bold text-card-foreground">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to continue to your dashboard.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="you@federalfirstlending.com"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Password
              </label>
              <div className="relative mt-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:scale-[0.99] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/auth/reset')}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot your password?
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
