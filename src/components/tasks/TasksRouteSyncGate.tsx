'use client';

import React from 'react';

type TasksRouteSyncGateProps = {
  children: React.ReactNode;
};

export function TasksRouteSyncGate({ children }: TasksRouteSyncGateProps) {
  const [showOverlay, setShowOverlay] = React.useState(false);
  const tasksSyncUiEnabled = process.env.NEXT_PUBLIC_TASKS_SYNC_UI_ENABLED !== 'false';

  React.useEffect(() => {
    if (!tasksSyncUiEnabled) return;
    const pending = window.sessionStorage.getItem('ffl:tasks-sync-pending') === '1';
    if (!pending) return;

    setShowOverlay(true);
    window.sessionStorage.removeItem('ffl:tasks-sync-pending');
    window.sessionStorage.setItem('ffl:tasks-sync-seen', '1');

    const timeoutId = window.setTimeout(() => {
      setShowOverlay(false);
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [tasksSyncUiEnabled]);

  return (
    <div className="relative">
      {children}
      {showOverlay && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-start justify-center rounded-2xl bg-slate-100/20 pt-[14vh] backdrop-blur-[2px]">
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 px-6 py-6 shadow-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_46%),radial-gradient(circle_at_top_right,rgba(147,51,234,0.16),transparent_46%)]" />
            <div className="relative flex flex-col items-center justify-center gap-4 text-center">
              <div className="relative h-20 w-20">
                <div className="app-sync-spinner-main absolute inset-0 rounded-full" />
                <div className="app-sync-spinner-accent absolute inset-[6px] rounded-full opacity-75" />
                <div className="absolute inset-[12px] rounded-full border border-slate-200/80 bg-white/95" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_18px_rgba(34,197,94,0.65)]" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                Syncing Tasks
              </h2>
              <p className="max-w-xl text-sm font-medium text-slate-600">
                Bringing in the latest queue status, timeline updates, and role activity...
              </p>
              <div className="relative mt-1 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-slate-200/70">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-violet-500 via-rose-500 via-cyan-500 to-emerald-500 opacity-75" />
                <div className="app-sync-progress-shimmer absolute inset-y-0 w-1/3 bg-white/70 blur-[1px]" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
