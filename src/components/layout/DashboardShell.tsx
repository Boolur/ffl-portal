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
        <div className="w-full p-6">
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
