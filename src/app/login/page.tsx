import Image from 'next/image';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center app-shell-bg px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.1),transparent_50%)]" />
      
      <div className="w-full max-w-[420px] relative z-10">
        <div className="flex justify-center mb-8">
          <div className="relative h-28 w-80">
            <Image
              src="/assets/Federal-First-Lending-text.png"
              alt="BISU Home Loans"
              fill
              className="object-contain drop-shadow-sm"
              priority
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/95 backdrop-blur-xl p-8 shadow-2xl shadow-slate-950/10">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Employee Portal</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with your BISU Home Loans credentials
            </p>
          </div>
          <LoginForm />
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Secure internal portal for BISU Home Loans employees.
            <br />
            Need access? Contact your IT administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
