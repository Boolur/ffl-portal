'use client';

import React from 'react';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

type DashboardShellProps = {
  children: React.ReactNode;
  user: { name: string; role: string };
};

function DashboardContent({ children, user }: DashboardShellProps) {
  const { activeRole, availableRoles, setActiveRole } = useImpersonation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { update } = useSession();
  const tasksSyncUiEnabled = process.env.NEXT_PUBLIC_TASKS_SYNC_UI_ENABLED !== 'false';
  const [routeOverlay, setRouteOverlay] = React.useState<{
    targetHref: string;
    mode: 'basic' | 'tasks-sync';
    startedAt: number;
  } | null>(null);

  React.useEffect(() => {
    if (!tasksSyncUiEnabled) return;

    const onNavigationIntent = (event: Event) => {
      const customEvent = event as CustomEvent<{ href?: string }>;
      const href = customEvent.detail?.href;
      if (!href || href === pathname) return;

      const isTasksRoute = href === '/tasks';
      let mode: 'basic' | 'tasks-sync' = 'basic';
      if (isTasksRoute) {
        const seenTasksSync = window.sessionStorage.getItem('ffl:tasks-sync-seen') === '1';
        if (!seenTasksSync) {
          mode = 'tasks-sync';
          window.sessionStorage.setItem('ffl:tasks-sync-pending', '1');
        } else {
          window.sessionStorage.removeItem('ffl:tasks-sync-pending');
        }
      }

      setRouteOverlay({
        targetHref: href,
        mode,
        startedAt: Date.now(),
      });
    };

    window.addEventListener('ffl:navigation-intent', onNavigationIntent as EventListener);
    return () => {
      window.removeEventListener('ffl:navigation-intent', onNavigationIntent as EventListener);
    };
  }, [pathname, tasksSyncUiEnabled]);

  React.useEffect(() => {
    if (!routeOverlay) return;
    const timeoutId = window.setTimeout(() => {
      setRouteOverlay(null);
    }, 12000);
    return () => window.clearTimeout(timeoutId);
  }, [routeOverlay]);

  React.useEffect(() => {
    if (!routeOverlay) return;
    if (pathname !== routeOverlay.targetHref) return;

    const elapsed = Date.now() - routeOverlay.startedAt;
    const minVisibleMs = routeOverlay.mode === 'tasks-sync' ? 650 : 220;
    const remainingMs = Math.max(0, minVisibleMs - elapsed);
    const timeoutId = window.setTimeout(() => {
      setRouteOverlay(null);
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [pathname, routeOverlay]);

  React.useEffect(() => {
    const shouldAutoRefresh =
      pathname === '/' || pathname === '/tasks';
    if (!shouldAutoRefresh) return;

    const INTERACTION_PAUSE_MS = 4000;
    let lastInteractionAt = Date.now();
    const markInteraction = () => {
      lastInteractionAt = Date.now();
    };

    const refreshIfSafe = () => {
      if (document.visibilityState !== 'visible') return;

      // Skip auto-refresh while an interactive modal is open.
      if (document.querySelector('[data-live-refresh-pause="true"]')) return;

      // Briefly pause refresh after recent user interaction to avoid UI interruptions.
      if (Date.now() - lastInteractionAt < INTERACTION_PAUSE_MS) return;

      router.refresh();
    };

    const interval = window.setInterval(refreshIfSafe, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      // Allow immediate catch-up refresh when the tab becomes visible.
      lastInteractionAt = 0;
      refreshIfSafe();
    };

    const handleWindowFocus = () => {
      // Allow immediate catch-up refresh when user returns to window.
      lastInteractionAt = 0;
      refreshIfSafe();
    };

    document.addEventListener('pointerdown', markInteraction, true);
    document.addEventListener('keydown', markInteraction, true);
    document.addEventListener('input', markInteraction, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('pointerdown', markInteraction, true);
      document.removeEventListener('keydown', markInteraction, true);
      document.removeEventListener('input', markInteraction, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [pathname, router]);

  // Create a display user that reflects the impersonated role
  const displayUser = {
    name: user.name,
    role: activeRole,
  };

  const handleRoleChange = React.useCallback(
    async (nextRole: UserRole) => {
      if (nextRole === activeRole) return;
      setActiveRole(nextRole);
      await update({ activeRole: nextRole });
      router.refresh();
    },
    [activeRole, router, setActiveRole, update]
  );

  return (
    <div className="min-h-screen app-shell-bg">
      <Sidebar
        collapsed={sidebarCollapsed}
      />
      <TopNav
        user={displayUser}
        availableRoles={availableRoles}
        onRoleChange={handleRoleChange}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
      />
      <main
        className={`pt-16 min-h-screen transition-all duration-300 ${
          sidebarCollapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        <div className="relative w-full p-6">
          {routeOverlay && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center rounded-2xl bg-slate-100/20 pt-6 backdrop-blur-[2px]">
              <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 px-6 py-6 shadow-2xl">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_46%),radial-gradient(circle_at_top_right,rgba(147,51,234,0.14),transparent_46%)]" />
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
                    {routeOverlay.mode === 'tasks-sync' ? 'Syncing Tasks' : 'Loading'}
                  </h2>
                  <p className="max-w-xl text-sm font-medium text-slate-600">
                    {routeOverlay.mode === 'tasks-sync'
                      ? 'Refreshing borrower queues, ownership updates, and latest task activity...'
                      : 'Loading the selected workspace...'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                      Disclosure
                    </span>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700">
                      QC
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                      VA
                    </span>
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-700">
                      JR Processor
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                      Completed
                    </span>
                  </div>
                  <div className="relative mt-1 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-slate-200/70">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-violet-500 via-rose-500 via-cyan-500 to-emerald-500 opacity-75" />
                    <div className="app-sync-progress-shimmer absolute inset-y-0 w-1/3 bg-white/70 blur-[1px]" />
                  </div>
                </div>
              </div>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  return (
    <DashboardContent user={user}>
      {children}
    </DashboardContent>
  );
}
