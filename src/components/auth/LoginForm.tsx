'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { getSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { UserRole } from '@prisma/client';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
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
        const session = await getSession();
        const roles = session?.user?.roles || [];
        const destination =
          session?.user?.role === UserRole.ONBOARDING || roles.includes(UserRole.ONBOARDING)
            ? '/onboarding'
            : result.url || '/';
        router.replace(destination);
        return;
      }

      setError('Sign in failed. Please try again.');
      setLoading(false);
    } catch {
      setError('Sign in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div>
        <label
          htmlFor="login-email"
          className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-input bg-background/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="you@bisuhomeloans.com"
          required
        />
      </div>
      <div>
        <label
          htmlFor="login-password"
          className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-input bg-background/50 px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
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
  );
}
