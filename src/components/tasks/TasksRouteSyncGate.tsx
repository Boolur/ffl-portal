'use client';

import React from 'react';

export function TasksRouteSyncGate({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // The route has arrived. Keep the existing navigation indicator while loading,
    // but do not cover ready tasks with an additional timed "sync" animation.
    window.sessionStorage.removeItem('ffl:tasks-sync-pending');
    window.sessionStorage.removeItem('ffl:tasks-sync-pending-at');
    window.sessionStorage.setItem('ffl:tasks-sync-seen', '1');
  }, []);

  return <div className="relative">{children}</div>;
}
