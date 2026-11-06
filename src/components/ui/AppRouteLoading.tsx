'use client';

import { Loader2 } from 'lucide-react';
import { useDashboardShellMode } from '@/components/layout/DashboardShellContext';

export function AppRouteLoading({ label = 'Loading...' }: { label?: string }) {
  const inShell = useDashboardShellMode() === 'shared';
  return (
    <div
      className={inShell
        ? 'flex min-h-[40vh] items-center justify-center'
        : 'fixed inset-0 z-[50] flex items-center justify-center bg-white/80 backdrop-blur-[2px]'}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-500">{label}</p>
      </div>
    </div>
  );
}
