'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, LogOut, Moon, PanelLeft, Search, Shield, Sun } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { useRouter } from 'next/navigation';
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/actions/notificationActions';

const THEME_STORAGE_KEY = 'ffl-theme-preference';

const formatRole = (role: string) => role.replace(/_/g, ' ');
const getRoleChipClass = (role: UserRole) => {
  if (role === UserRole.LOAN_OFFICER) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (role === UserRole.QC) {
    return 'border-violet-200 bg-violet-50 text-violet-700';
  }
  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  return 'border-border bg-card text-muted-foreground';
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
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSwitchingRole, setIsSwitchingRole] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const sessionEmail = session?.user?.email?.toLowerCase().trim() || '';
  const canToggleTheme =
    sessionEmail === 'mmahjoub@federalfirstlending.com' && user.role === UserRole.LOAN_OFFICER;

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
    if (!canToggleTheme) {
      document.documentElement.setAttribute('data-theme', 'light');
      setTheme('light');
      return;
    }

    const storedTheme =
      window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', storedTheme);
    setTheme(storedTheme);
  }, [canToggleTheme]);

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

  const handleThemeToggle = () => {
    if (!canToggleTheme) return;
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  return (
    <header
      className={`h-16 border-b border-border app-glass flex items-center justify-between px-4 sm:px-6 fixed top-0 right-0 z-10 transition-all duration-300 ${
        sidebarCollapsed ? 'left-20' : 'left-64'
      }`}
    >
      <div className="flex items-center flex-1 max-w-xl min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="mr-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </span>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-input rounded-lg leading-5 bg-card placeholder:text-muted-foreground text-foreground focus:outline-none focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary sm:text-sm transition-all"
            placeholder="Search loans, borrowers, or tasks..."
          />
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {canToggleTheme && (
          <button
            type="button"
            onClick={handleThemeToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        )}
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
            <div className="absolute right-0 top-[2.8rem] z-20 w-[360px] overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border bg-secondary/70 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-foreground">Notifications</p>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {unreadCount} unread
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  disabled={isMarkingAllRead || unreadCount === 0}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isMarkingAllRead ? 'Marking...' : 'Mark all read'}
                </button>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {isLoadingNotifications && notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm font-medium text-muted-foreground">
                    Loading notifications...
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm font-medium text-muted-foreground">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleNotificationClick(item)}
                      className={`w-full border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                        item.readAt ? 'bg-card hover:bg-secondary' : 'bg-primary/10 hover:bg-primary/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-xs font-bold text-foreground">{item.title}</p>
                        <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] font-medium text-muted-foreground">
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
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-foreground">{user.name}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              {formatRole(user.role)}
            </p>
          </div>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card pr-1.5 pl-0.5 shadow-sm transition-all hover:bg-secondary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open user menu"
          >
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-secondary to-muted flex items-center justify-center text-foreground font-bold border border-border">
              {user.name.charAt(0)}
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[3.25rem] w-56 overflow-hidden rounded-2xl border border-border bg-card shadow-xl py-1 z-20">
              <div className="px-3 py-3 border-b border-border bg-secondary/70">
                <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  {formatRole(user.role)}
                </p>
              </div>
              {availableRoles.length > 1 && (
                <div className="px-3 pt-2 pb-1">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
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
                            : 'border-border bg-card text-muted-foreground hover:bg-secondary'
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
