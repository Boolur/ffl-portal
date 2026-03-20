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
        <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/94 backdrop-blur-sm">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_45%),radial-gradient(circle_at_top_right,rgba(147,51,234,0.16),transparent_45%)]" />
          <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 animate-ping rounded-full bg-blue-600" />
              <span className="h-2.5 w-2.5 animate-ping rounded-full bg-violet-600 [animation-delay:140ms]" />
              <span className="h-2.5 w-2.5 animate-ping rounded-full bg-rose-500 [animation-delay:280ms]" />
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Syncing Tasks
            </h2>
            <p className="max-w-xl text-sm font-medium text-slate-600">
              Bringing in the latest queue status, timeline updates, and role activity...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
