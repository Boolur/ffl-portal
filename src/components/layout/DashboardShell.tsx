'use client';

import React from 'react';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useImpersonation } from '@/lib/impersonation';
import { ImpersonationControls } from '@/components/admin/ImpersonationControls';
import { UserRole } from '@prisma/client';
import { usePathname, useRouter } from 'next/navigation';

type DashboardShellProps = {
  children: React.ReactNode;
  user: { name: string; role: string }; // Real user from session
};

function DashboardContent({ children, user }: DashboardShellProps) {
  const { activeRole } = useImpersonation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    const shouldAutoRefresh =
      pathname === '/' || pathname === '/tasks';
    if (!shouldAutoRefresh) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;

      const activeElement = document.activeElement as HTMLElement | null;
      const isTyping =
        !!activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.isContentEditable);
      if (isTyping) return;

      // Skip auto-refresh while an interactive modal is open.
      if (document.querySelector('[data-live-refresh-pause="true"]')) return;

      router.refresh();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [pathname, router]);

  // Create a display user that reflects the impersonated role
  const displayUser = {
    name: user.name,
    role: activeRole,
  };

  return (
    <div className="min-h-screen app-shell-bg">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
      />
      <TopNav
        user={displayUser}
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
      <ImpersonationControls currentUserRole={user.role as UserRole} />
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
