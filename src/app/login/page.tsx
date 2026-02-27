'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import Image from 'next/image';

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
    <div className="min-h-screen flex flex-col items-center justify-center app-shell-bg px-4 py-12 relative overflow-hidden">
      {/* Subtle background pattern matching the brand's professional feel */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.1),transparent_50%)]" />
      
      <div className="w-full max-w-[420px] relative z-10">
        {/* Company Logo */}
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

        {/* Login Card */}
        <div className="rounded-2xl border border-border bg-card/95 backdrop-blur-xl p-8 shadow-2xl shadow-slate-950/10">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Employee Portal</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with your Federal First Lending credentials
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-input bg-background/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                placeholder="you@federalfirstlending.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background/50 px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="••••••••"
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
              className="mt-2 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm"
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

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Secure internal portal for Federal First Lending employees.
            <br />
            Need access? Contact your IT administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
