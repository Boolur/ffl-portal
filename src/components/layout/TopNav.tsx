'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, PanelLeft, Shield } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { useRouter } from 'next/navigation';
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/actions/notificationActions';

const formatRole = (role: string) => role.replace(/_/g, ' ');
const getRoleChipClass = (role: UserRole) => {
  if (role === UserRole.LOAN_OFFICER) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (role === UserRole.LOA) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (role === UserRole.QC) {
    return 'border-violet-200 bg-violet-50 text-violet-700';
  }
  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  if (role === UserRole.VA || role === UserRole.VA_TITLE || role === UserRole.VA_PAYOFF || role === UserRole.VA_APPRAISAL) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (role === UserRole.PROCESSOR_JR) {
    return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  }
  if (role === UserRole.MANAGER) {
    return 'border-slate-900 bg-slate-900 text-white';
  }
  return 'border-slate-200 bg-white text-slate-600';
};

const getRoleAvatarClass = (role: UserRole) => {
  if (role === UserRole.LOAN_OFFICER) return 'from-amber-100 to-amber-200 text-amber-800 border-amber-200';
  if (role === UserRole.LOA) return 'from-amber-100 to-amber-200 text-amber-800 border-amber-200';
  if (role === UserRole.DISCLOSURE_SPECIALIST) return 'from-blue-100 to-blue-200 text-blue-800 border-blue-200';
  if (role === UserRole.QC) return 'from-violet-100 to-violet-200 text-violet-800 border-violet-200';
  if (role === UserRole.VA || role === UserRole.VA_TITLE || role === UserRole.VA_PAYOFF || role === UserRole.VA_APPRAISAL) {
    return 'from-rose-100 to-rose-200 text-rose-800 border-rose-200';
  }
  if (role === UserRole.PROCESSOR_JR) return 'from-cyan-100 to-cyan-200 text-cyan-800 border-cyan-200';
  if (role === UserRole.MANAGER) return 'from-slate-800 to-slate-900 text-white border-slate-700';
  return 'from-slate-100 to-slate-200 text-slate-700 border-slate-200';
};

const formatRelativeTime = (iso: string) => {
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return '';
  const deltaMs = Date.now() - created.getTime();
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return created.toLocaleDateString();
};

type NotificationItem = {
  id: string;
  eventLabel: string;
  title: string;
  message: string;
  href: string | null;
  createdAt: string;
  readAt: string | null;
};

export function TopNav({
  user,
  availableRoles,
  onRoleChange,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  user: { name: string; role: UserRole };
  availableRoles: UserRole[];
  onRoleChange: (role: UserRole) => Promise<void>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSwitchingRole, setIsSwitchingRole] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);

  const loadNotifications = React.useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoadingNotifications(true);
    try {
      const result = await getMyNotifications(12);
      if (!result.success) return;
      setNotifications(result.notifications as NotificationItem[]);
      setUnreadCount(result.unreadCount);
    } finally {
      if (showLoader) setIsLoadingNotifications(false);
    }
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target as Node)
      ) {
        setNotificationOpen(false);
      }
    };

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setNotificationOpen(false);
      }
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  useEffect(() => {
    void loadNotifications(true);
  }, [loadNotifications]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadNotifications(false);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [loadNotifications]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    await signOut({ callbackUrl: '/login' });
  };

  const handleRoleSelect = async (role: UserRole) => {
    if (isSwitchingRole || role === user.role) return;
    setIsSwitchingRole(true);
    try {
      await onRoleChange(role);
      setMenuOpen(false);
    } finally {
      setIsSwitchingRole(false);
    }
  };

  const handleOpenNotifications = async () => {
    const nextOpen = !notificationOpen;
    setNotificationOpen(nextOpen);
    if (!nextOpen) return;
    await loadNotifications(true);
  };

  const handleMarkAllRead = async () => {
    if (isMarkingAllRead || unreadCount === 0) return;
    setIsMarkingAllRead(true);
    try {
      const result = await markAllNotificationsRead();
      if (!result.success) return;
      setNotifications((prev) =>
        prev.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleNotificationClick = async (item: NotificationItem) => {
    if (!item.readAt) {
      const result = await markNotificationRead(item.id);
      if (result.success) {
        setNotifications((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? { ...entry, readAt: new Date().toISOString() }
              : entry
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    }

    setNotificationOpen(false);
    router.push(item.href || '/tasks');
  };

  return (
    <header
      className={`h-16 border-b border-border app-glass flex items-center justify-between px-4 sm:px-6 fixed top-0 right-0 z-10 transition-all duration-300 ${
        sidebarCollapsed ? 'left-20' : 'left-64'
      }`}
    >
      <div className="flex items-center flex-1 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="mr-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center space-x-4">
        <div ref={notificationRef} className="relative">
          <button
            type="button"
            onClick={() => void handleOpenNotifications()}
            className="p-2 text-muted-foreground hover:text-foreground relative hover:bg-secondary rounded-full transition-colors"
            aria-haspopup="menu"
            aria-expanded={notificationOpen}
            aria-label="Open notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-card"></span>
            )}
          </button>

          {notificationOpen && (
            <div className="absolute right-0 top-[2.8rem] z-20 w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Notifications</p>
                  <p className="text-[11px] font-medium text-slate-500">
                    {unreadCount} unread
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  disabled={isMarkingAllRead || unreadCount === 0}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isMarkingAllRead ? 'Marking...' : 'Mark all read'}
                </button>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {isLoadingNotifications && notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm font-medium text-slate-500">
                    Loading notifications...
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm font-medium text-slate-500">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleNotificationClick(item)}
                      className={`w-full border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                        item.readAt ? 'bg-white hover:bg-slate-50' : 'bg-blue-50/40 hover:bg-blue-50/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-xs font-bold text-slate-800">{item.title}</p>
                        <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] font-medium text-slate-600">
                        {item.message}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div ref={menuRef} className="relative flex items-center space-x-3 pl-4 border-l border-border">
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200/90 bg-white shadow-sm transition-all hover:shadow-md hover:bg-slate-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open user menu"
          >
            <div className={`h-9 w-9 rounded-lg bg-gradient-to-br flex items-center justify-center font-extrabold border ${getRoleAvatarClass(user.role)}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[3.25rem] w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl py-1 z-20">
              <div className="px-3 py-3 border-b border-slate-100 bg-slate-50/70">
                <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
                <p className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getRoleChipClass(user.role)}`}>
                  <Shield className="h-3 w-3" />
                  {formatRole(user.role)}
                </p>
              </div>
              {availableRoles.length > 1 && (
                <div className="px-3 pt-2 pb-1">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Switch Role
                  </p>
                  <div className="space-y-1">
                    {availableRoles.map((role) => (
                      <button
                        key={role}
                        onClick={() => handleRoleSelect(role)}
                        disabled={isSwitchingRole}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                          user.role === role
                            ? getRoleChipClass(role)
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {formatRole(role)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="m-1.5 w-[calc(100%-0.75rem)] inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                role="menuitem"
              >
                <LogOut className="h-4 w-4" />
                {isSigningOut ? 'Signing out...' : 'Log out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
