import { Loader2 } from 'lucide-react';

export function AppRouteLoading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div
      className="fixed inset-0 z-[50] flex items-center justify-center bg-white/80 backdrop-blur-[2px]"
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
