'use client';

import React from 'react';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useImpersonation } from '@/lib/impersonation';
import { UserRole } from '@prisma/client';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { PortalLiveProvider } from './PortalLiveProvider';
import { DashboardShellContext, useDashboardShellMode } from './DashboardShellContext';
import { dashboardShellIdentity, isPortalWorkspacePath } from '@/lib/dashboardShellRoutes';
import { invalidateSupportSummary } from '@/lib/supportSummaryLoader';
import { resetPortalIdentity } from '@/lib/portalLiveUpdates';

const SupportChatWidget = dynamic(
  () =>
    import('@/components/support/SupportChatWidget').then(
      (module) => module.SupportChatWidget
    ),
  { ssr: false }
);

type DashboardShellProps = {
  children: React.ReactNode;
  user: { name: string; role: string };
};

function DashboardContent({ children, user }: DashboardShellProps) {
  const { activeRole, availableRoles, setActiveRole } = useImpersonation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { update } = useSession();
  const [loadingRoute, setLoadingRoute] = React.useState(false);
  const routeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = React.useRef<HTMLElement | null>(null);
  const scrollPositions = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    const onNavigationIntent = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (!href || href === pathname) return;
      if (routeTimer.current) clearTimeout(routeTimer.current);
      routeTimer.current = setTimeout(() => setLoadingRoute(true), 180);
    };
    window.addEventListener('ffl:navigation-intent', onNavigationIntent);
    return () => {
      window.removeEventListener('ffl:navigation-intent', onNavigationIntent);
      if (routeTimer.current) clearTimeout(routeTimer.current);
    };
  }, [pathname]);

  React.useEffect(() => {
    setLoadingRoute(false);
    setMobileSidebarOpen(false);
  }, [pathname]);

  React.useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const target = scrollPositions.current.get(pathname) ?? 0;
    let restoring = true;
    let resizeObserver: ResizeObserver | undefined;
    const restore = () => {
      if (!restoring) return;
      main.scrollTop = target;
      if (main.scrollHeight - main.clientHeight >= target) {
        restoring = false;
        resizeObserver?.disconnect();
      }
    };
    const rememberScroll = () => {
      if (restoring) return;
      const positions = scrollPositions.current;
      positions.delete(pathname);
      positions.set(pathname, main.scrollTop);
      while (positions.size > 8) positions.delete(positions.keys().next().value!);
    };
    const stopRestoring = () => { restoring = false; resizeObserver?.disconnect(); };
    // A streamed route may initially contain only its short loading panel.
    // Restore after content arrives instead of replacing the saved position with 0.
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(restore);
      if (main.firstElementChild) resizeObserver.observe(main.firstElementChild);
    }
    restore();
    main.addEventListener('scroll', rememberScroll, { passive: true });
    main.addEventListener('wheel', stopRestoring, { passive: true });
    main.addEventListener('touchstart', stopRestoring, { passive: true });
    main.addEventListener('pointerdown', stopRestoring);
    main.addEventListener('keydown', stopRestoring);
    return () => {
      resizeObserver?.disconnect();
      main.removeEventListener('scroll', rememberScroll);
      main.removeEventListener('wheel', stopRestoring);
      main.removeEventListener('touchstart', stopRestoring);
      main.removeEventListener('pointerdown', stopRestoring);
      main.removeEventListener('keydown', stopRestoring);
    };
  }, [pathname]);

  // Create a display user that reflects the impersonated role
  const displayUser = {
    name: user.name,
    role: activeRole,
  };

  const handleRoleChange = React.useCallback(
    async (nextRole: UserRole) => {
      if (nextRole === activeRole) return;
      resetPortalIdentity();
      invalidateSupportSummary();
      const updatedSession = await update({ activeRole: nextRole });
      const confirmedRole = updatedSession?.user?.activeRole || updatedSession?.user?.role;
      if (confirmedRole) setActiveRole(confirmedRole as UserRole);
      router.refresh();
    },
    [activeRole, router, setActiveRole, update]
  );

  const handleToggleSidebar = React.useCallback(() => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setMobileSidebarOpen((prev) => !prev);
      return;
    }
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="h-[100dvh] overflow-hidden app-shell-bg">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <div
        className={`flex h-full min-h-0 flex-col transition-all duration-300 ml-0 ${
          sidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
        }`}
      >
        <TopNav
          user={displayUser}
          availableRoles={availableRoles}
          onRoleChange={handleRoleChange}
          onToggleSidebar={handleToggleSidebar}
        />
        <main ref={mainRef} id="app-main-scroll" className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative min-h-full w-full p-3 sm:p-4 md:p-6">
            {loadingRoute && (
              <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-1 overflow-hidden bg-primary/10">
                <span className="sr-only">Loading workspace...</span>
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
      <SupportChatWidget activeRole={activeRole} />
    </div>
  );
}

/** Page wrappers are transparent inside the persistent root shell. */
export function DashboardShell({ children, user }: DashboardShellProps) {
  const mode = useDashboardShellMode();
  if (mode !== 'standalone') return <>{children}</>;
  return (
    <DashboardShellContext.Provider value="shared">
      <DashboardContent user={user}>{children}</DashboardContent>
    </DashboardShellContext.Provider>
  );
}

/** Kept in RootLayout so navigation replaces only the workspace contents. */
export function PersistentDashboardShell({ children, initialRevisions }: { children: React.ReactNode; initialRevisions?: Partial<Record<import('@/lib/portalLiveUpdates').PortalTopic, string>> }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { activeRole, availableRoles } = useImpersonation();
  const userId = session?.user?.id;
  const identity = userId ? dashboardShellIdentity(userId, activeRole, availableRoles) : '';
  const [readyIdentity, setReadyIdentity] = React.useState(identity);
  React.useLayoutEffect(() => {
    if (identity === readyIdentity) return;
    // Clear the old scope before mounting children that capture a cache epoch.
    // Resetting on initial mount would invalidate that new child's own writes.
    resetPortalIdentity();
    invalidateSupportSummary();
    setReadyIdentity(identity);
  }, [identity, readyIdentity]);
  const portalRoute = isPortalWorkspacePath(pathname);
  React.useEffect(() => {
    if (!portalRoute) return;
    if (status === 'unauthenticated') router.replace('/login');
    else if (userId && activeRole === UserRole.ONBOARDING) router.replace('/onboarding');
  }, [portalRoute, status, userId, activeRole, router]);
  if (identity !== readyIdentity || (portalRoute && (!userId || status === 'unauthenticated' || activeRole === UserRole.ONBOARDING))) {
    return <DashboardShellContext.Provider value="bare"><div role="status" className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading your workspace...</div></DashboardShellContext.Provider>;
  }
  const showShell = Boolean(userId) && status !== 'unauthenticated' &&
    activeRole !== UserRole.ONBOARDING && portalRoute;
  if (!showShell) return <DashboardShellContext.Provider value="bare">{children}</DashboardShellContext.Provider>;
  return (
    <DashboardShellContext.Provider value="shared">
      <PortalLiveProvider key={identity} initialRevisions={initialRevisions}>
        <DashboardContent user={{ name: session?.user?.name || 'User', role: activeRole }}>
          {children}
        </DashboardContent>
      </PortalLiveProvider>
    </DashboardShellContext.Provider>
  );
}
